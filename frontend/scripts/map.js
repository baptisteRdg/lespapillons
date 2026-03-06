/**
 * Module Carte - Gestion de la carte MapLibre GL JS et des interactions
 */

const STORAGE_VERSION = '4';

function checkStorageVersion() {
    const stored = localStorage.getItem('storage_version');
    if (stored !== STORAGE_VERSION) {
        console.warn(`🗑️ LocalStorage obsolète (v${stored} → v${STORAGE_VERSION}), purge...`);
        localStorage.removeItem('favorites');
        localStorage.removeItem('user_position');
        localStorage.removeItem('map_style');
        localStorage.setItem('storage_version', STORAGE_VERSION);
    }
}

// ── Cache local des favoris (synchronisé avec l'API) ─────────────────────────
let _favoritesCache = [];

async function loadFavorites() {
    if (!isLoggedIn()) {
        _favoritesCache = [];
        updateFavoritesCount();
        return;
    }
    try {
        const res = await _authFetch(`${getApiBaseUrl()}/favorites`);
        const data = await res.json();
        if (data.success) {
            _favoritesCache = data.data || [];
        }
    } catch (err) {
        console.error('Erreur chargement favoris:', err);
    }
    updateFavoritesCount();
}

function saveUserPosition(lat, lng) {
    localStorage.setItem('user_position', JSON.stringify({ lat, lng }));
}

function getSavedPosition() {
    try {
        const raw = localStorage.getItem('user_position');
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

// ── Token Jawg ──────────────────────────────────────────────────────────────
const JAWG_TOKEN = 'q8ENjbC5b2HaKNzPYe09LRKGCNFudkoHzE5iHznAfmXmBwohhWjfKj1wuFMDNn3H';

const MAP_STYLES = {
    propre: {
        label: T.MAP_STYLES.propre,
        url: `https://tile.jawg.io/dfc3a626-e8ca-4cd6-8ad5-0f7e06729444/{z}/{x}/{y}{r}.png?access-token=${JAWG_TOKEN}`
    },
    satellite: {
        label: T.MAP_STYLES.satellite,
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
    },
    nuit: {
        label: T.MAP_STYLES.nuit,
        url: 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    },
    simple: {
        label: T.MAP_STYLES.simple,
        url: `https://tile.jawg.io/jawg-streets/{z}/{x}/{y}{r}.png?access-token=${JAWG_TOKEN}`
    }
};

const MAP_CONFIG = {
    center: [2.3522, 48.8566], // [lng, lat] — Paris
    zoom: 12,
    minZoom: 3,
    maxZoom: 18,
};

// Variables globales
let map;
let currentStyleKey = 'propre';
const activityPool = new Map();
const MAX_POOL = 400;
let searchMarkers = [];
let isSearchMode = false;
let lastLoadedBounds = null;
let lastLoadedZoom = null;
let viewportLoadTimeout = null;
let userMarker;
let userPosition = [48.8566, 2.3522]; // [lat, lng] interne, converti en [lng, lat] pour MapLibre
let currentPanelActivityId = null;

// ── Map Style ────────────────────────────────────────────────────────────────

function _buildRasterStyle(tileUrl) {
    return {
        version: 8,
        sources: {
            'raster-tiles': {
                type: 'raster',
                tiles: [tileUrl],
                tileSize: 256
            }
        },
        layers: [{
            id: 'raster-layer',
            type: 'raster',
            source: 'raster-tiles'
        }]
    };
}

function setMapStyle(styleKey, save = true) {
    const style = MAP_STYLES[styleKey];
    if (!style) return;

    if ((styleKey === 'simple' || styleKey === 'propre') && !JAWG_TOKEN) {
        showToast(T.TOASTS.ERROR, 'info');
        return;
    }

    map.setStyle(_buildRasterStyle(style.url));
    currentStyleKey = styleKey;
    if (save) localStorage.setItem('map_style', styleKey);

    document.querySelectorAll('.style-option').forEach(el => {
        el.classList.toggle('active', el.dataset.style === styleKey);
    });
}

// ── Header / Style picker ────────────────────────────────────────────────────

function syncHeaderHeight() {
    const h = document.querySelector('header')?.offsetHeight ?? 60;
    document.documentElement.style.setProperty('--header-h', h + 'px');
}

function computeMarkerOffset() {
    if (window.innerWidth < 768) {
        const headerH  = document.querySelector('header')?.offsetHeight ?? 60;
        const panelH   = window.innerHeight * 0.38;
        const visibleH = window.innerHeight - headerH - panelH;
        const targetY  = headerH + visibleH * 0.3;
        return window.innerHeight / 2 - targetY;
    }
    return -100;
}

function initStylePicker() {
    const toggle = document.getElementById('style-picker-toggle');
    const panel  = document.getElementById('style-picker-panel');
    if (!toggle || !panel) return;

    syncHeaderHeight();
    window.addEventListener('resize', syncHeaderHeight);

    document.querySelectorAll('.style-option').forEach(el => {
        el.classList.toggle('active', el.dataset.style === currentStyleKey);
    });

    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.classList.toggle('open');
    });

    panel.addEventListener('click', (e) => {
        const option = e.target.closest('.style-option');
        if (!option) return;
        setMapStyle(option.dataset.style);
        panel.classList.remove('open');
    });

    document.addEventListener('click', () => panel.classList.remove('open'));
    panel.addEventListener('click', (e) => e.stopPropagation());
}

// ── Map Init ─────────────────────────────────────────────────────────────────

function initMap() {
    const saved = getSavedPosition();
    if (saved) {
        userPosition = [saved.lat, saved.lng];
        console.log(`📍 Position restaurée depuis localStorage: ${saved.lat.toFixed(4)}, ${saved.lng.toFixed(4)}`);
    }

    const savedStyle = localStorage.getItem('map_style') || 'propre';
    currentStyleKey = savedStyle;
    const styleObj = MAP_STYLES[savedStyle] || MAP_STYLES.propre;

    map = new maplibregl.Map({
        container: 'map',
        style: _buildRasterStyle(styleObj.url),
        center: [userPosition[1], userPosition[0]], // [lng, lat]
        zoom: MAP_CONFIG.zoom,
        minZoom: MAP_CONFIG.minZoom,
        maxZoom: MAP_CONFIG.maxZoom,
        attributionControl: false
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    map.on('moveend', () => {
        if (isSearchMode) return;
        clearTimeout(viewportLoadTimeout);
        viewportLoadTimeout = setTimeout(loadActivitiesInViewport, 400);
    });

    map.on('click', (e) => {
        if (e.originalEvent.target.closest('.maplibregl-marker')) return;
        hideActivityPanel();
        if (window.innerWidth < 768) hideFavoritesPanel();
    });

    map.on('load', () => {
        createUserMarker();

        if (saved) {
            loadActivitiesInViewport();
        } else {
            trySetUserPositionFromBrowser();
        }

        handleDeepLink();
    });
}

// ── Geolocation ──────────────────────────────────────────────────────────────

function trySetUserPositionFromBrowser() {
    if (!navigator.geolocation) {
        loadActivitiesInViewport();
        return;
    }
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            userPosition = [lat, lng];
            saveUserPosition(lat, lng);
            map.setCenter([lng, lat]);
            userMarker.setLngLat([lng, lat]);
            loadActivitiesInViewport();
        },
        () => {
            loadActivitiesInViewport();
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
}

// ── User Marker ──────────────────────────────────────────────────────────────

function createUserMarker() {
    const el = document.createElement('div');
    el.className = 'user-marker-container';
    el.innerHTML = '<div class="user-marker"><img src="assets/icon/you.svg" alt="" class="user-marker-icon"></div>';

    userMarker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat([userPosition[1], userPosition[0]])
        .addTo(map);

    userMarker.on('drag', () => {
        const lngLat = userMarker.getLngLat();
        userPosition = [lngLat.lat, lngLat.lng];
    });

    userMarker.on('dragend', () => {
        const lngLat = userMarker.getLngLat();
        userPosition = [lngLat.lat, lngLat.lng];
        saveUserPosition(lngLat.lat, lngLat.lng);
    });
}

// ── Activity loading ─────────────────────────────────────────────────────────

function getLimitPerType(zoom) {
    if (zoom >= 16) return 50;
    if (zoom >= 14) return 20;
    if (zoom >= 12) return 10;
    return 5;
}

function showMapLoader() { document.getElementById('map-loader')?.classList.add('visible'); }
function hideMapLoader() { document.getElementById('map-loader')?.classList.remove('visible'); }

function needsReload() {
    if (!lastLoadedBounds || lastLoadedZoom === null) return true;
    const zoom = map.getZoom();
    if (Math.abs(zoom - lastLoadedZoom) >= 1) return true;
    const bounds = map.getBounds();
    return !lastLoadedBounds.contains(bounds.getNorthEast()) ||
           !lastLoadedBounds.contains(bounds.getSouthWest());
}

async function loadActivitiesInViewport() {
    if (isSearchMode) return;
    if (!needsReload()) {
        console.log('⏭️ Viewport inchangé, pas de rechargement');
        return;
    }
    try {
        showMapLoader();
        const bounds = map.getBounds();
        const zoom = map.getZoom();
        const limitPerType = getLimitPerType(zoom);

        // Pad bounds by extending 50% in each direction
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        const latPad = (ne.lat - sw.lat) * 0.5;
        const lngPad = (ne.lng - sw.lng) * 0.5;
        lastLoadedBounds = new maplibregl.LngLatBounds(
            [sw.lng - lngPad, sw.lat - latPad],
            [ne.lng + lngPad, ne.lat + latPad]
        );
        lastLoadedZoom = zoom;

        const newActivities = await getActivitiesByBbox(bounds, limitPerType);
        mergeIntoPool(newActivities);
        cleanupPool();
        updateFavoritesCount();

        console.log(`🗺️ Pool: ${activityPool.size} activités chargées (zoom=${Math.round(zoom)}, limitPerType=${limitPerType})`);
    } catch (error) {
        console.error('Erreur lors du chargement du viewport:', error);
    } finally {
        hideMapLoader();
    }
}

function mergeIntoPool(newActivities) {
    newActivities.forEach(activity => {
        if (!activityPool.has(activity.id)) {
            const marker = createMarker(activity);
            activityPool.set(activity.id, { activity, marker });
        }
    });
}

function cleanupPool() {
    if (activityPool.size <= MAX_POOL) return;

    const center = map.getCenter();
    const bounds = map.getBounds();

    const entries = [...activityPool.entries()].map(([id, entry]) => ({
        id,
        entry,
        dist: calculateDistance(center.lat, center.lng, entry.activity.lat, entry.activity.lng),
        inBounds: bounds.contains([entry.activity.lng, entry.activity.lat])
    }));

    entries.sort((a, b) => {
        if (a.inBounds !== b.inBounds) return a.inBounds ? 1 : -1;
        return b.dist - a.dist;
    });

    const toEvict = entries.slice(0, activityPool.size - MAX_POOL);
    toEvict.forEach(({ id, entry }) => {
        entry.marker.remove();
        activityPool.delete(id);
    });

    console.log(`🧹 Pool nettoyé : ${toEvict.length} activités évincées, ${activityPool.size} restantes`);
}

// ── Activity Marker ──────────────────────────────────────────────────────────

function createMarker(activity, addToMap = true) {
    const iconConfig = getIconConfig(activity.category);

    const fallbackIcon = iconConfig.icon || 'map-marker-alt';
    const iconHtml = iconConfig.svg
        ? `<img src="${iconConfig.svg}" alt="" style="width:20px;height:20px;filter:invert(1);" onerror="this.style.display='none';this.nextElementSibling.style.display='inline';"><i class="fas fa-${fallbackIcon}" style="display:none"></i>`
        : `<i class="fas fa-${iconConfig.icon}"></i>`;

    const MARKER_COLORS = {
        blue:'#476e99', gray:'#a7a7a7', green:'#58763a', red:'#cf0a1d',
        yellow:'#fce883', purple:'#cc99ff', orange:'#fea347', pink:'#e9ace9', cyan:'#87d3f8',
    };
    const bgColor = MARKER_COLORS[iconConfig.color] || MARKER_COLORS.blue;

    const el = document.createElement('div');
    el.className = 'custom-marker';
    el.innerHTML = `<div class="activity-marker-pin" style="background-color:${bgColor}">${iconHtml}</div>`;

    const marker = new maplibregl.Marker({ element: el })
        .setLngLat([activity.lng, activity.lat]);

    if (addToMap) {
        marker.addTo(map);
    }

    el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const zoom = Math.max(map.getZoom(), 15);
        const point = map.project([activity.lng, activity.lat]);
        point.y += computeMarkerOffset();
        const offsetLngLat = map.unproject(point);
        map.flyTo({ center: offsetLngLat, zoom, duration: 400 });
        await loadAndShowActivityDetails(activity.id, marker);
    });

    return marker;
}

// ── Activity Panel ───────────────────────────────────────────────────────────

function showActivityPanel(html, activityId) {
    const panel   = document.getElementById('activity-panel');
    const content = document.getElementById('panel-content');
    if (!panel || !content) return;

    content.innerHTML = html;
    currentPanelActivityId = activityId;

    panel.classList.remove('panel-expanded');
    panel.classList.add('panel-open');
}

function hideActivityPanel() {
    const panel = document.getElementById('activity-panel');
    if (!panel) return;
    panel.classList.remove('panel-open', 'panel-expanded');
    currentPanelActivityId = null;
}

function initActivityPanel() {
    const panel  = document.getElementById('activity-panel');
    const handle = document.getElementById('panel-drag-handle');
    const close  = document.getElementById('panel-close');
    if (!panel) return;

    close?.addEventListener('click', hideActivityPanel);

    if (!handle) return;

    let touchStartY = 0;
    let startExpanded = false;

    handle.addEventListener('touchstart', (e) => {
        touchStartY = e.touches[0].clientY;
        startExpanded = panel.classList.contains('panel-expanded');
    }, { passive: true });

    handle.addEventListener('touchend', (e) => {
        const delta = touchStartY - e.changedTouches[0].clientY;
        if (delta > 40) {
            panel.classList.add('panel-expanded');
        } else if (delta < -40) {
            if (startExpanded) {
                panel.classList.remove('panel-expanded');
            } else {
                hideActivityPanel();
            }
        }
    }, { passive: true });

    handle.addEventListener('click', () => {
        panel.classList.toggle('panel-expanded');
    });
}

async function loadAndShowActivityDetails(activityId, marker) {
    try {
        console.log(`📄 Ouverture fiche activité #${activityId}`);

        if (currentPanelActivityId === activityId) {
            console.log('✋ Fiche déjà ouverte, on ne fait rien');
            return;
        }

        showActivityPanel(`<div class="popup-loading"><i class="fas fa-spinner fa-spin popup-loading-spinner"></i><p class="popup-loading-text">${T.LOADING}</p></div>`, activityId);

        const details = await getActivityDetails(activityId);

        if (!details) {
            console.error(`❌ Impossible de charger #${activityId}`);
            showActivityPanel(`<div class="popup-error">${T.TOASTS.LOAD_ERROR}</div>`, activityId);
            return;
        }

        console.log(`✅ Fiche #${activityId} prête`);

        showActivityPanel(createPopupContent(details), activityId);
        setTimeout(() => setupPopupEventListeners(details), 10);
        enrichPopupAsync(details.id, details);

    } catch (error) {
        console.error(`❌ Erreur fiche #${activityId}:`, error);
        showActivityPanel(`<div class="popup-error">${T.TOASTS.LOAD_ERROR}</div>`, activityId);
    }
}

// ── Icon config ──────────────────────────────────────────────────────────────

function typeToIconFilename(type) {
    if (!type) return 'autre';
    return type.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .trim().replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
}

const ICON_COLORS = {
    'parc':'green', 'golf':'green', 'accrobranche':'green', 'escalade':'green', 'randonnee':'green',
    'musee':'blue', 'musée':'blue', 'castle':'orange', 'chateau':'orange',
    'cinema':'purple', 'cinéma':'purple', 'escapegame':'purple', 'lasergame':'purple', 'bowling':'purple',
    'nightclub':'purple', 'bar':'purple', 'queen':'pink',
    'iceskating':'cyan', 'piscine':'cyan',
    'autre':'gray',
};

function getIconConfig(category) {
    const key = category?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const fileBase = typeToIconFilename(category);

    const ICON_OVERRIDES = {
        'autre': { icon: 'map-marker-alt', color: ICON_COLORS['autre'] || 'gray' }
    };
    const overrideKey = Object.keys(ICON_OVERRIDES).find(k =>
        k.normalize('NFD').replace(/[\u0300-\u036f]/g, '') === key
    );
    if (overrideKey) return ICON_OVERRIDES[overrideKey];

    const color = ICON_COLORS[key] || 'blue';
    return { svg: `assets/icon/${fileBase}.svg`, color };
}

// ── Enrichment (Wikidata / og:image) ─────────────────────────────────────────

async function enrichPopupAsync(activityId, details) {
    console.log(`✨ Enrichissement popup #${activityId} — wikidata=${details.wikidata ?? 'aucun'}`);

    let wikidataData = {};
    if (details.wikidata) {
        wikidataData = await getWikidataData(details.wikidata);
    }

    let imageUrl = details.image || wikidataData.imageUrl || null;
    if (!imageUrl && details.website) {
        console.log(`🌐 Fallback og:image pour popup #${activityId}`);
        imageUrl = await getOgImage(details.website);
    }

    if (imageUrl) {
        const img = document.getElementById(`popup-header-img-${activityId}`);
        const header = document.getElementById(`popup-header-${activityId}`);
        if (img && header && !header.classList.contains('has-image') && !img.src) {
            img.onload = () => header.classList.add('has-image');
            img.onerror = () => console.warn(`⚠️ Image non chargeable pour popup #${activityId}`);
            img.src = imageUrl;
        }
    }

    if (!details.description && wikidataData.description) {
        const el = document.getElementById(`popup-desc-${activityId}`);
        const block = document.getElementById(`popup-info-${activityId}`);
        if (el) { el.textContent = wikidataData.description; el.style.display = ''; if (block) block.style.display = ''; }
    }

    if (!details.address && wikidataData.address) {
        const el = document.getElementById(`popup-addr-${activityId}`);
        const block = document.getElementById(`popup-info-${activityId}`);
        if (el) { const span = el.querySelector('span'); if (span) span.textContent = wikidataData.address; el.style.display = ''; if (block) block.style.display = ''; }
    }

    if (!details.website && wikidataData.website) {
        const el = document.getElementById(`popup-web-${activityId}`);
        const block = document.getElementById(`popup-links-${activityId}`);
        if (el) { el.href = wikidataData.website; el.style.display = ''; if (block) block.style.display = ''; }
    }

    if (!details.phone && wikidataData.phone) {
        const el = document.getElementById(`popup-phone-${activityId}`);
        const block = document.getElementById(`popup-links-${activityId}`);
        if (el) { el.href = `tel:${wikidataData.phone}`; const span = el.querySelector('span'); if (span) span.textContent = wikidataData.phone; el.style.display = ''; if (block) block.style.display = ''; }
    }
}

// ── Popup HTML ───────────────────────────────────────────────────────────────

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function _ratingBadgeHtml(avg, total) {
    if (!avg || total === 0) return '';
    const cls = avg >= 4 ? 'rating-badge-green' : avg >= 3 ? 'rating-badge-orange' : 'rating-badge-red';
    return `<span class="rating-badge ${cls}" title="${total} avis">★ ${avg}</span>`;
}

function _ratingBarHtml(userRating, activityId) {
    const LABELS = [
        { v: 1, label: T.RATING_LABELS[1], cls: 'rating-btn-1' },
        { v: 2, label: T.RATING_LABELS[2], cls: 'rating-btn-2' },
        { v: 3, label: T.RATING_LABELS[3], cls: 'rating-btn-3' },
        { v: 4, label: T.RATING_LABELS[4], cls: 'rating-btn-4' },
        { v: 5, label: T.RATING_LABELS[5], cls: 'rating-btn-5' }
    ];
    const buttons = LABELS.map(({ v, label, cls }) => {
        const active = userRating === v ? ' rating-btn-active' : '';
        return `<button class="rating-btn ${cls}${active}" data-action="rate" data-id="${activityId}" data-value="${v}">${label}</button>`;
    }).join('');
    return `<div class="rating-bar" id="rating-bar-${activityId}">${buttons}</div>`;
}

function createPopupContent(activity) {
    const isFavorite = isActivityFavorite(activity.id);
    const favoriteClass = isFavorite ? 'active' : '';
    const favoriteIcon  = isFavorite ? 'fa-solid' : 'fa-regular';

    const categoryClass = (activity.category || 'autre')
        .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-');

    const safeTitle    = escapeHtml(activity.title);
    const safeCategory = escapeHtml(activity.category || T.LABELS.CATEGORY_OTHER);
    const safeAddress  = escapeHtml(activity.address || '');
    const safeDesc     = escapeHtml(activity.description || '');
    const safePhone    = escapeHtml(activity.phone || '');
    const safeWebsite  = activity.website && /^https?:\/\//i.test(activity.website) ? escapeHtml(activity.website) : '';

    const avgBadge = _ratingBadgeHtml(activity.avgRating, activity.totalRatings || 0);

    return `
        <div class="popup-content">
            <div class="popup-header" id="popup-header-${activity.id}">
                <img class="popup-header-img" id="popup-header-img-${activity.id}" alt="" aria-hidden="true">
                <div class="popup-header-text">
                    <h3 class="popup-title">${safeTitle}</h3>
                    <div class="popup-header-meta">
                        <span class="category-badge category-${categoryClass}">${safeCategory}</span>
                        <span id="rating-avg-badge-${activity.id}">${avgBadge}</span>
                    </div>
                </div>
            </div>
            <div class="popup-body">
                <div class="popup-info-block" id="popup-info-${activity.id}"${!activity.address && !activity.description ? ' style="display:none"' : ''}>
                    <p class="popup-address" id="popup-addr-${activity.id}"${!activity.address ? ' style="display:none"' : ''}>
                        <i class="fas fa-map-marker-alt popup-address-icon"></i>
                        <span>${safeAddress}</span>
                    </p>
                    <p class="popup-description" id="popup-desc-${activity.id}"${!activity.description ? ' style="display:none"' : ''}>${safeDesc}</p>
                </div>
                <div class="popup-links" id="popup-links-${activity.id}"${!activity.website && !activity.phone ? ' style="display:none"' : ''}>
                    <a href="${safeWebsite || '#'}" target="_blank" rel="noopener noreferrer" class="popup-link" id="popup-web-${activity.id}"${!safeWebsite ? ' style="display:none"' : ''}>
                        <i class="fas fa-globe"></i>
                        <span class="popup-link-label">${T.LABELS.VISIT_WEBSITE}</span>
                    </a>
                    <a href="tel:${safePhone}" class="popup-link" id="popup-phone-${activity.id}"${!activity.phone ? ' style="display:none"' : ''}>
                        <i class="fas fa-phone"></i>
                        <span>${safePhone}</span>
                    </a>
                </div>
            </div>
            <div class="rating-section">
                ${_ratingBarHtml(null, activity.id)}
            </div>
            <div class="popup-footer">
                <button class="popup-btn btn-favorite ${favoriteClass}" data-action="favorite" data-id="${activity.id}">
                    <i class="${favoriteIcon} fa-heart"></i>
                    <span>${isFavorite ? T.BUTTONS.FAVORITE : T.BUTTONS.ADD}</span>
                </button>
                <button class="popup-btn btn-todo" data-action="todo" data-id="${activity.id}" id="todo-btn-${activity.id}">
                    <i class="fas fa-clipboard-list"></i>
                    <span>${T.BUTTONS.TODO}</span>
                </button>
                <button class="popup-btn btn-itinerary" data-action="itinerary" data-id="${activity.id}">
                    <i class="fas fa-route"></i>
                    <span>${T.BUTTONS.ITINERARY}</span>
                </button>
                <button class="popup-btn btn-similar" data-action="similar" data-id="${activity.id}">
                    <i class="fas fa-search"></i>
                    <span>${T.BUTTONS.SIMILAR}</span>
                </button>
                <button class="popup-btn btn-share" data-action="share" data-id="${activity.id}" data-title="${escapeHtml(activity.title)}">
                    <i class="fas fa-share-nodes"></i>
                    <span>${T.BUTTONS.SHARE}</span>
                </button>
            </div>
        </div>
    `;
}

// ── Popup event listeners ────────────────────────────────────────────────────

function setupPopupEventListeners(activity) {
    const favoriteBtn = document.querySelector('[data-action="favorite"]');
    if (favoriteBtn) {
        favoriteBtn.addEventListener('click', () => {
            toggleFavorite(activity.id, {
                id: activity.id, name: activity.title,
                lat: activity.lat, lng: activity.lng, type: activity.category
            });
        });
    }

    const todoBtn = document.querySelector('[data-action="todo"]');
    if (todoBtn) {
        todoBtn.addEventListener('click', () => {
            onAuthRequired(async () => {
                try {
                    const isActive = todoBtn.classList.contains('active');
                    const method = isActive ? 'DELETE' : 'POST';
                    const res = await _authFetch(`${getApiBaseUrl()}/users/me/todo/${activity.id}`, { method });
                    const data = await res.json();
                    if (data.success) _updateTodoBtn(activity.id, !isActive);
                    showToast(data.message || (isActive ? T.TOASTS.TODO_REMOVED : T.TOASTS.TODO_ADDED), data.success ? 'success' : 'error');
                } catch { showToast(T.TOASTS.NETWORK_ERROR, 'error'); }
            });
        });
    }

    loadUserTodoStatus(activity.id);

    const itineraryBtn = document.querySelector('[data-action="itinerary"]');
    if (itineraryBtn) itineraryBtn.addEventListener('click', () => openItinerary(activity.lat, activity.lng));

    const similarBtn = document.querySelector('[data-action="similar"]');
    if (similarBtn) similarBtn.addEventListener('click', () => showSimilarActivities(activity.category));

    const shareBtn = document.querySelector('[data-action="share"]');
    if (shareBtn) shareBtn.addEventListener('click', () => shareActivity(activity.id, activity.title));

    document.querySelectorAll(`[data-action="rate"][data-id="${activity.id}"]`).forEach(btn => {
        btn.addEventListener('click', () => {
            const value = parseInt(btn.dataset.value);
            onAuthRequired(() => submitRating(activity.id, value));
        });
    });

    loadUserRating(activity.id);
}

function _updateTodoBtn(activityId, isInTodo) {
    const btn = document.getElementById(`todo-btn-${activityId}`);
    if (!btn) return;
    btn.classList.toggle('active', isInTodo);
    const icon = btn.querySelector('i');
    if (icon) icon.className = isInTodo ? 'fas fa-clipboard-check' : 'fas fa-clipboard-list';
    const label = btn.querySelector('span');
    if (label) label.textContent = isInTodo ? T.BUTTONS.TODO_CHECKED : T.BUTTONS.TODO;
}

async function loadUserTodoStatus(activityId) {
    try {
        const token = typeof getAuthToken === 'function' ? getAuthToken() : null;
        if (!token) return;
        const res = await fetch(`${API_BASE_URL}/users/me/todo/${activityId}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data = await res.json();
        if (data.inTodo) _updateTodoBtn(activityId, true);
    } catch {}
}

async function loadUserRating(activityId) {
    try {
        const token  = typeof getAuthToken === 'function' ? getAuthToken() : null;
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const res    = await fetch(`${API_BASE_URL}/ratings/activity/${activityId}`, { headers });
        if (!res.ok) return;
        const data = await res.json();

        if (data.average) {
            const badgeEl = document.getElementById(`rating-avg-badge-${activityId}`);
            if (badgeEl) {
                const cls = data.average >= 4 ? 'rating-badge-green' : data.average >= 3 ? 'rating-badge-orange' : 'rating-badge-red';
                badgeEl.innerHTML = `<span class="rating-badge ${cls}" title="${data.totalVotes} avis">★ ${data.average}</span>`;
            }
        }
        if (data.userRating) _updateRatingBar(activityId, data.userRating);
    } catch {}
}

async function submitRating(activityId, value) {
    try {
        const token = typeof getAuthToken === 'function' ? getAuthToken() : null;
        if (!token) return;
        const res  = await fetch(`${API_BASE_URL}/ratings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ activityId, value })
        });
        const data = await res.json();
        if (!data.success) { showToast(data.message || T.TOASTS.ERROR, 'error'); return; }
        _updateRatingBar(activityId, value);
        if (data.average) {
            const badgeEl = document.getElementById(`rating-avg-badge-${activityId}`);
            if (badgeEl) {
                const cls = data.average >= 4 ? 'rating-badge-green' : data.average >= 3 ? 'rating-badge-orange' : 'rating-badge-red';
                badgeEl.innerHTML = `<span class="rating-badge ${cls}" title="${data.totalVotes} avis">★ ${data.average}</span>`;
            }
        }
        showToast(T.TOASTS.RATING_SUCCESS(T.RATING_LABELS[value]), 'success');
    } catch { showToast(T.TOASTS.NETWORK_ERROR, 'error'); }
}

function _updateRatingBar(activityId, selectedValue) {
    const bar = document.getElementById(`rating-bar-${activityId}`);
    if (!bar) return;
    bar.querySelectorAll('.rating-btn').forEach(btn => {
        btn.classList.toggle('rating-btn-active', parseInt(btn.dataset.value) === selectedValue);
    });
}

// ── Favorites ────────────────────────────────────────────────────────────────

function toggleFavorite(activityId, activityData = null) {
    onAuthRequired(async () => {
        const isFav = isActivityFavorite(activityId);
        try {
            const method = isFav ? 'DELETE' : 'POST';
            const res = await _authFetch(`${getApiBaseUrl()}/favorites/${activityId}`, { method });
            const data = await res.json();

            if (data.success) {
                if (isFav) {
                    _favoritesCache = _favoritesCache.filter(f => f.id !== activityId);
                    showToast(T.TOASTS.FAVORITE_REMOVED, 'info');
                } else {
                    const poolEntry = activityPool.get(activityId);
                    const source = activityData || (poolEntry ? poolEntry.activity : null);
                    if (source) {
                        _favoritesCache.push({
                            id: source.id, name: source.name || source.title,
                            lat: source.lat, lng: source.lng, type: source.type || source.category
                        });
                    }
                    showToast(T.TOASTS.FAVORITE_ADDED, 'success');
                }
                updateFavoritesCount();
                _refreshFavPanel();

                const favoriteBtn = document.querySelector(`[data-action="favorite"][data-id="${activityId}"]`);
                if (favoriteBtn) {
                    const nowFav = isActivityFavorite(activityId);
                    favoriteBtn.classList.toggle('active', nowFav);
                    favoriteBtn.querySelector('i').className = `${nowFav ? 'fa-solid' : 'fa-regular'} fa-heart`;
                    const label = favoriteBtn.querySelector('span');
                    if (label) label.textContent = nowFav ? T.BUTTONS.FAVORITE : T.BUTTONS.ADD;
                }
            }
        } catch (err) {
            console.error('Erreur toggle favori:', err);
            showToast(T.TOASTS.NETWORK_ERROR || 'Erreur réseau', 'error');
        }
    });
}

function openItinerary(destLat, destLng) {
    const lngLat = userMarker.getLngLat();
    const url = `https://www.google.com/maps/dir/?api=1&origin=${lngLat.lat},${lngLat.lng}&destination=${destLat},${destLng}&travelmode=driving`;
    window.open(url, '_blank');
}

function showSimilarActivities(category) {
    showToast(T.TOASTS.SIMILAR_SOON, 'info');
}

async function shareActivity(activityId, title) {
    const url = `${window.location.origin}${window.location.pathname}?activity=${activityId}`;
    if (navigator.share) {
        try { await navigator.share({ title, url }); } catch {}
    } else {
        try {
            await navigator.clipboard.writeText(url);
            showToast(T.TOASTS.LINK_COPIED, 'success');
        } catch { showToast(T.TOASTS.LINK_FALLBACK(url), 'info'); }
    }
}

async function handleDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const activityId = parseInt(params.get('activity'));
    if (!activityId) return;

    history.replaceState({}, '', window.location.pathname);
    console.log(`🔗 Deep link détecté : activité #${activityId}`);

    const details = await getActivityDetails(activityId);
    if (!details || !details.lat) {
        showToast(T.TOASTS.ACTIVITY_NOT_FOUND, 'info');
        return;
    }

    let poolEntry = activityPool.get(activityId);
    let marker;
    if (poolEntry) {
        marker = poolEntry.marker;
    } else {
        const activity = { id: activityId, lat: details.lat, lng: details.lng, category: details.category };
        marker = createMarker(activity);
        activityPool.set(activityId, { activity, marker });
    }

    const zoom = Math.max(map.getZoom(), 15);
    const point = map.project([details.lng, details.lat]);
    point.y += computeMarkerOffset();
    const offsetLngLat = map.unproject(point);
    map.flyTo({ center: offsetLngLat, zoom, duration: 400 });

    await loadAndShowActivityDetails(activityId, marker);
}

function getFavorites() { return _favoritesCache; }
function isActivityFavorite(activityId) { return _favoritesCache.some(f => f.id === activityId); }

function updateFavoritesCount() {
    const badge = document.getElementById('favCount');
    if (!badge) return;
    const count = _favoritesCache.length;
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
}

// ── Favorites Panel ──────────────────────────────────────────────────────────

let _favPanelOpen = false;

function _buildFavoritesListHtml() {
    const favorites = getFavorites();
    const header = `<div class="fav-list-header"><i class="fas fa-heart"></i><h3>Mes Favoris</h3></div>`;
    if (favorites.length === 0) {
        return `${header}<div class="fav-list-content"><p class="fav-empty">${T.EMPTY?.FAVORITES || 'Aucun favori pour le moment'}</p></div>`;
    }
    const items = favorites.map(fav => {
        const catClass = (fav.type || 'autre').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-');
        return `
            <div class="fav-item" data-lat="${fav.lat}" data-lng="${fav.lng}" data-id="${fav.id}">
                <div class="fav-item-header">
                    <span class="fav-item-name">${escapeHtml(fav.name)}</span>
                    <button class="remove-favorite" data-id="${fav.id}" aria-label="Retirer"><i class="fas fa-heart-broken"></i></button>
                </div>
                <div class="fav-item-meta">
                    <span class="category-badge category-${catClass}">${escapeHtml(fav.type || 'Autre')}</span>
                </div>
            </div>`;
    }).join('');
    return `${header}<div class="fav-list-content">${items}</div>`;
}

function showFavoritesPanel() {
    const panel   = document.getElementById('favorites-panel');
    const content = document.getElementById('fav-panel-content');
    if (!panel || !content) return;

    const isMobile = window.innerWidth < 768;
    if (isMobile && currentPanelActivityId !== null) {
        hideActivityPanel();
        setTimeout(() => _openFavPanel(panel, content), 200);
    } else {
        _openFavPanel(panel, content);
    }
}

function _openFavPanel(panel, content) {
    _favPanelOpen = true;
    content.innerHTML = _buildFavoritesListHtml();
    panel.classList.remove('panel-expanded');
    panel.classList.add('panel-open');
    _bindFavoritesEvents();
}

function _bindFavoritesEvents() {
    const content = document.getElementById('fav-panel-content');
    if (!content) return;

    content.querySelectorAll('.fav-item[data-lat]').forEach(el => {
        el.addEventListener('click', (e) => {
            if (e.target.closest('.remove-favorite')) return;
            const lat = parseFloat(el.dataset.lat);
            const lng = parseFloat(el.dataset.lng);

            const zoom = Math.max(map.getZoom(), 15);
            const point = map.project([lng, lat]);
            point.y += computeMarkerOffset();
            const offsetLngLat = map.unproject(point);
            map.flyTo({ center: offsetLngLat, zoom, duration: 400 });
        });
    });

    content.querySelectorAll('.remove-favorite').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFavorite(parseInt(btn.dataset.id));
        });
    });
}

function _refreshFavPanel() {
    if (!_favPanelOpen) return;
    const content = document.getElementById('fav-panel-content');
    if (!content) return;
    content.innerHTML = _buildFavoritesListHtml();
    _bindFavoritesEvents();
}

function hideFavoritesPanel() {
    _favPanelOpen = false;
    const panel = document.getElementById('favorites-panel');
    if (panel) panel.classList.remove('panel-open', 'panel-expanded');
}

function initFavoritesPanel() {
    const panel  = document.getElementById('favorites-panel');
    const handle = document.getElementById('fav-drag-handle');
    const close  = document.getElementById('fav-panel-close');
    if (!panel) return;

    close?.addEventListener('click', hideFavoritesPanel);
    if (!handle) return;

    let touchStartY = 0;
    let startExpanded = false;

    handle.addEventListener('touchstart', (e) => {
        touchStartY = e.touches[0].clientY;
        startExpanded = panel.classList.contains('panel-expanded');
    }, { passive: true });

    handle.addEventListener('touchend', (e) => {
        const delta = touchStartY - e.changedTouches[0].clientY;
        if (delta > 40) panel.classList.add('panel-expanded');
        else if (delta < -40) {
            if (startExpanded) panel.classList.remove('panel-expanded');
            else hideFavoritesPanel();
        }
    }, { passive: true });

    handle.addEventListener('click', () => panel.classList.toggle('panel-expanded'));
}

// ── Toast ────────────────────────────────────────────────────────────────────

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');

    const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };

    toast.className = `toast-${type}`;
    toastMessage.innerHTML = `<i class="fas ${icons[type]}"></i>${message}`;
    toast.style.transform = 'translateX(-50%) translateY(0)';

    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
        toast.style.transform = 'translateX(-50%) translateY(-8rem)';
    }, 3000);
}

// ── Search ───────────────────────────────────────────────────────────────────

function enterSearchMode(results) {
    isSearchMode = true;
    // Hide existing markers
    activityPool.forEach(({ marker }) => marker.getElement().style.display = 'none');
    // Remove old search markers
    searchMarkers.forEach(({ marker }) => marker.remove());
    searchMarkers = [];
    results.forEach(activity => {
        const marker = createMarker(activity);
        searchMarkers.push({ marker, activity });
    });
}

function exitSearchMode() {
    isSearchMode = false;
    searchMarkers.forEach(({ marker }) => marker.remove());
    searchMarkers = [];
    // Show pool markers again
    activityPool.forEach(({ marker }) => marker.getElement().style.display = '');
    loadActivitiesInViewport();
}

async function searchActivities(searchTerm) {
    if (!searchTerm || searchTerm.trim() === '') {
        exitSearchMode();
        return;
    }

    const term = searchTerm.trim();
    console.log(`🔍 Recherche globale côté serveur pour "${term}"`);
    const lngLat = userMarker.getLngLat();
    const results = await searchActivitiesGlobal(term, lngLat.lat, lngLat.lng);

    enterSearchMode(results);

    if (results.length === 0) {
        showToast(T.TOASTS.SEARCH_NO_RESULTS(term), 'info');
    } else {
        showToast(T.TOASTS.SEARCH_RESULTS(results.length), 'success');
        await centerOnSearchResults(results);
    }
}

async function centerOnSearchResults(results) {
    if (results.length === 1) {
        const activity = results[0];
        const zoom = Math.max(map.getZoom(), 15);
        const point = map.project([activity.lng, activity.lat]);
        point.y += computeMarkerOffset();
        const offsetLngLat = map.unproject(point);
        map.flyTo({ center: offsetLngLat, zoom, duration: 400 });

        const entry = searchMarkers.find(e =>
            Math.abs(e.activity.lat - activity.lat) < 0.0001 &&
            Math.abs(e.activity.lng - activity.lng) < 0.0001
        );
        if (entry) await loadAndShowActivityDetails(activity.id, entry.marker);
    } else {
        const bounds = new maplibregl.LngLatBounds();
        results.forEach(a => bounds.extend([a.lng, a.lat]));
        map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 400 });
    }
}

// ── Viewport lock ────────────────────────────────────────────────────────────

function lockViewport() {
    document.addEventListener('touchstart', (e) => {
        if (e.touches.length > 1) e.preventDefault();
    }, { passive: false });

    document.addEventListener('gesturestart',  (e) => e.preventDefault(), { passive: false });
    document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
    window.addEventListener('scroll', () => window.scrollTo(0, 0), { passive: true });
}

// ── DOMContentLoaded ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    checkStorageVersion();
    lockViewport();
    initMap();
    initStylePicker();
    initActivityPanel();
    initFavoritesPanel();
    loadFavorites();

    const favToggle = document.getElementById('fav-picker-toggle');
    if (favToggle) {
        favToggle.addEventListener('click', () => {
            if (_favPanelOpen) hideFavoritesPanel();
            else showFavoritesPanel();
        });
    }

    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        let searchTimeout;
        searchInput.addEventListener('input', (e) => {
            const val = e.target.value;
            clearTimeout(searchTimeout);
            if (val.length > 0 && val.trim().length < 4) return;
            searchTimeout = setTimeout(() => searchActivities(val), 300);
        });

        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                clearTimeout(searchTimeout);
                searchActivities(e.target.value);
            }
        });
    }

    document.addEventListener('keydown', (e) => {
        const tag = document.activeElement?.tagName;
        const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;

        if (e.key === '/' && !isTyping) {
            e.preventDefault();
            searchInput?.focus();
            searchInput?.select();
            return;
        }

        if (e.key === 'Escape') {
            if (_favPanelOpen) hideFavoritesPanel();
            else if (currentPanelActivityId !== null) hideActivityPanel();
            else if (isSearchMode && searchInput) { searchInput.value = ''; exitSearchMode(); }
            return;
        }

        if ((e.key === 'f' || e.key === 'F') && !isTyping) {
            if (_favPanelOpen) hideFavoritesPanel();
            else showFavoritesPanel();
            return;
        }
    });
});
