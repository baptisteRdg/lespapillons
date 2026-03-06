/**
 * Module Carte - Gestion de la carte Leaflet et des interactions
 */

// Version du localStorage — à incrémenter lors d'un changement de DB ou de format de données
const STORAGE_VERSION = '3';

/**
 * Vérifie la version du localStorage et purge les données si obsolètes
 */
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

/**
 * Charge les favoris depuis l'API backend.
 * Appelé à l'init et après chaque connexion.
 */
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

/**
 * Sauvegarde la position du marqueur utilisateur dans localStorage
 */
function saveUserPosition(lat, lng) {
    localStorage.setItem('user_position', JSON.stringify({ lat, lng }));
}

/**
 * Récupère la dernière position sauvegardée, ou null si aucune
 */
function getSavedPosition() {
    try {
        const raw = localStorage.getItem('user_position');
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

// ── Token Jawg (nécessaire pour les styles "Simple" et "Propre") ──────────────
// Créer un compte gratuit sur https://www.jawg.io pour obtenir un token
const JAWG_TOKEN = 'q8ENjbC5b2HaKNzPYe09LRKGCNFudkoHzE5iHznAfmXmBwohhWjfKj1wuFMDNn3H';

// Styles de carte disponibles
const MAP_STYLES = {
    papillon: {
        label: T.MAP_STYLES.papillon,
        url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png',
        options: { subdomains: 'abcd' }
    },
    satellite: {
        label: T.MAP_STYLES.satellite,
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        options: { maxZoom: 19 }
    },
    nuit: {
        label: T.MAP_STYLES.nuit,
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        options: { subdomains: 'abcd' }
    },
    simple: {
        label: T.MAP_STYLES.simple,
        url: `https://tile.jawg.io/jawg-streets/{z}/{x}/{y}{r}.png?access-token=${JAWG_TOKEN}`,
        options: {}
    },
    propre: {
        label: T.MAP_STYLES.propre,
        url: `https://tile.jawg.io/jawg-lagoon/{z}/{x}/{y}{r}.png?access-token=${JAWG_TOKEN}`,
        options: {}
    }
};

// Configuration de la carte
const MAP_CONFIG = {
    center: [48.8566, 2.3522], // Paris
    zoom: 12,
    minZoom: 3,
    maxZoom: 18,
};

// Variables globales
let map;
let currentTileLayer = null;
let currentStyleKey = 'propre';
const activityPool = new Map();           // id → { activity, marker }
const categoryClusterGroups = new Map();  // category → MarkerClusterGroup
const MAX_POOL = 400;
let searchMarkers = [];
let isSearchMode = false;
let lastLoadedBounds = null;  // Bounds lors du dernier chargement (avec padding)
let lastLoadedZoom = null;    // Zoom lors du dernier chargement
let viewportLoadTimeout = null; // Debounce du rechargement viewport
let userMarker;
let userPosition = MAP_CONFIG.center;
let currentPanelActivityId = null; // ID de l'activité actuellement affichée dans le panel

/**
 * Initialise la carte Leaflet
 */
/**
 * Change le style de la carte
 * @param {string} styleKey - Clé dans MAP_STYLES
 * @param {boolean} save - Sauvegarder dans localStorage (défaut: true)
 */
function setMapStyle(styleKey, save = true) {
    const style = MAP_STYLES[styleKey];
    if (!style) return;

    // Vérifier le token Jawg si nécessaire
    if ((styleKey === 'simple' || styleKey === 'propre') && !JAWG_TOKEN) {
        showToast(T.TOASTS.ERROR, 'info');
        return;
    }

    // Retirer le tile layer actuel
    if (currentTileLayer) map.removeLayer(currentTileLayer);

    // Ajouter le nouveau
    currentTileLayer = L.tileLayer(style.url, {
        minZoom: MAP_CONFIG.minZoom,
        maxZoom: MAP_CONFIG.maxZoom,
        ...style.options
    }).addTo(map);

    currentStyleKey = styleKey;
    if (save) localStorage.setItem('map_style', styleKey);

    // Mettre à jour l'UI du picker
    document.querySelectorAll('.style-option').forEach(el => {
        el.classList.toggle('active', el.dataset.style === styleKey);
    });
}

/**
 * Initialise le sélecteur de style de carte
 */
function syncHeaderHeight() {
    const h = document.querySelector('header')?.offsetHeight ?? 60;
    document.documentElement.style.setProperty('--header-h', h + 'px');
}

/**
 * Calcule l'offset vertical (px) à appliquer au point projeté pour positionner
 * le marker dans la zone visible optimale :
 *  - Mobile  : tiers supérieur de la zone libre (entre header et panel bas)
 *  - Desktop : léger décalage neutre (panel latéral gauche)
 * Valeur positive → le centre carte se place EN DESSOUS du marker → marker monte.
 * Valeur négative → le centre se place AU-DESSUS → marker descend.
 */
function computeMarkerOffset() {
    if (window.innerWidth < 768) {
        const headerH  = document.querySelector('header')?.offsetHeight ?? 60;
        const panelH   = window.innerHeight * 0.38; // panel ouvert = 38vh
        const visibleH = window.innerHeight - headerH - panelH;
        const targetY  = headerH + visibleH * 0.3; // 30 % depuis le haut de la zone libre
        return window.innerHeight / 2 - targetY;    // >0 : centre sous le marker
    }
    // Desktop : marker légèrement sous le centre (zone visible côté droit du panel)
    return -100;
}

function initStylePicker() {
    const toggle = document.getElementById('style-picker-toggle');
    const panel  = document.getElementById('style-picker-panel');
    if (!toggle || !panel) return;

    syncHeaderHeight();
    window.addEventListener('resize', syncHeaderHeight);

    // Marquer le style actif au chargement
    document.querySelectorAll('.style-option').forEach(el => {
        el.classList.toggle('active', el.dataset.style === currentStyleKey);
    });

    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.classList.toggle('open');
    });

    // Clic sur une option
    panel.addEventListener('click', (e) => {
        const option = e.target.closest('.style-option');
        if (!option) return;
        setMapStyle(option.dataset.style);
        panel.classList.remove('open');
    });

    // Fermer en cliquant ailleurs
    document.addEventListener('click', () => panel.classList.remove('open'));
    panel.addEventListener('click', (e) => e.stopPropagation());
}

function initMap() {
    // Utiliser la position sauvegardée si disponible, sinon Paris par défaut
    const saved = getSavedPosition();
    if (saved) {
        userPosition = [saved.lat, saved.lng];
        console.log(`📍 Position restaurée depuis localStorage: ${saved.lat.toFixed(4)}, ${saved.lng.toFixed(4)}`);
    }

    map = L.map('map', {
        zoomControl: false,
        attributionControl: false,
        tap: false,              // Désactive le tap handler Leaflet (conflits avec le navigateur mobile)
        tapTolerance: 15,        // Tolérance du tap sur mobile
        bounceAtZoomLimits: false // Supprime l'animation de rebond aux limites de zoom
    }).setView(userPosition, MAP_CONFIG.zoom);

    // Appliquer le style sauvegardé (ou papillon par défaut)
    const savedStyle = localStorage.getItem('map_style') || 'propre';
    setMapStyle(savedStyle, false);
    
    createUserMarker();

    map.on('moveend', () => {
        if (isSearchMode) return;
        clearTimeout(viewportLoadTimeout);
        viewportLoadTimeout = setTimeout(loadActivitiesInViewport, 400);
    });

    // Fermer le panel en cliquant sur la carte (mais pas sur un marker)
    map.on('click', () => {
        hideActivityPanel();
        if (window.innerWidth < 768) hideFavoritesPanel();
    });
    
    // Si position sauvegardée : chargement direct, pas besoin de géolocalisation
    // Sinon : tentative de géolocalisation (premier visit)
    if (saved) {
        loadActivitiesInViewport();
    } else {
        trySetUserPositionFromBrowser();
    }
}

/**
 * Place le marqueur sur la position du navigateur puis charge les activités une seule fois.
 * Si pas de géoloc ou refus/erreur : on charge quand même (Paris).
 */
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
            saveUserPosition(lat, lng); // Sauvegarder pour les prochaines visites
            map.setView(userPosition, MAP_CONFIG.zoom);
            userMarker.setLatLng(userPosition);
            loadActivitiesInViewport();
        },
        () => {
            // Refus ou erreur : on charge depuis Paris sans sauvegarder
            loadActivitiesInViewport();
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
}

/**
 * Crée le marqueur de position utilisateur (draggable)
 */
function createUserMarker() {
    const userIcon = L.divIcon({
        html: '<div class="user-marker"><img src="assets/icon/you.svg" alt="" class="user-marker-icon"></div>',
        className: 'user-marker-container',
        iconSize: [36, 36],
        iconAnchor: [18, 18]
    });
    
    userMarker = L.marker(userPosition, {
        icon: userIcon,
        draggable: true,
        zIndexOffset: 1000
    }).addTo(map);
    
    userMarker.on('drag', function(e) {
        const newPos = e.target.getLatLng();
        userPosition = [newPos.lat, newPos.lng];
    });
    
    userMarker.on('dragend', function(e) {
        const newPos = e.target.getLatLng();
        userPosition = [newPos.lat, newPos.lng];
        saveUserPosition(newPos.lat, newPos.lng);
    });
}


/**
 * Retourne le nombre max d'activités par type selon le niveau de zoom
 * @param {number} zoom
 * @returns {number}
 */
function getLimitPerType(zoom) {
    if (zoom >= 16) return 50;
    if (zoom >= 14) return 20;
    if (zoom >= 12) return 10;
    return 5;
}

/**
 * Charge les activités visibles dans le viewport courant et les fusionne dans le pool
 */
/**
 * Affiche ou cache le loader de carte
 */
function showMapLoader() { document.getElementById('map-loader')?.classList.add('visible'); }
function hideMapLoader() { document.getElementById('map-loader')?.classList.remove('visible'); }

/**
 * Détermine si un rechargement est nécessaire selon les bounds et le zoom actuels.
 * Évite les appels serveur inutiles lors de micro-déplacements.
 */
function needsReload() {
    if (!lastLoadedBounds || lastLoadedZoom === null) return true;
    const zoom = map.getZoom();
    if (Math.abs(zoom - lastLoadedZoom) >= 1) return true; // Changement de zoom significatif
    return !lastLoadedBounds.contains(map.getBounds());    // Viewport sorti de la zone chargée
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

        // Mémoriser les bounds avec 50% de padding pour éviter les rechargements trop fréquents
        lastLoadedBounds = bounds.pad(0.5);
        lastLoadedZoom = zoom;

        const newActivities = await getActivitiesByBbox(bounds, limitPerType);
        mergeIntoPool(newActivities);
        cleanupPool();
        updateFavoritesCount();

        console.log(`🗺️ Pool: ${activityPool.size} activités chargées (zoom=${zoom}, limitPerType=${limitPerType})`);
    } catch (error) {
        console.error('Erreur lors du chargement du viewport:', error);
    } finally {
        hideMapLoader();
    }
}

/**
 * Fusionne de nouvelles activités dans le pool sans recréer les markers existants
 * @param {Array} newActivities
 */
function mergeIntoPool(newActivities) {
    newActivities.forEach(activity => {
        if (!activityPool.has(activity.id)) {
            const marker = createMarker(activity);
            activityPool.set(activity.id, { activity, marker });
        }
    });
}

/**
 * Évince les activités les plus éloignées du centre si le pool dépasse MAX_POOL
 */
function cleanupPool() {
    if (activityPool.size <= MAX_POOL) return;

    const center = map.getCenter();
    const bounds = map.getBounds();

    // Trier : d'abord hors viewport (candidats à l'éviction), puis par distance décroissante
    const entries = [...activityPool.entries()].map(([id, entry]) => ({
        id,
        entry,
        dist: calculateDistance(center.lat, center.lng, entry.activity.lat, entry.activity.lng),
        inBounds: bounds.contains([entry.activity.lat, entry.activity.lng])
    }));

    entries.sort((a, b) => {
        if (a.inBounds !== b.inBounds) return a.inBounds ? 1 : -1; // hors bounds en premier
        return b.dist - a.dist; // plus loin en premier
    });

    const toEvict = entries.slice(0, activityPool.size - MAX_POOL);
    toEvict.forEach(({ id, entry }) => {
        const group = categoryClusterGroups.get(entry.activity.category || 'autre');
        if (group) group.removeLayer(entry.marker);
        else map.removeLayer(entry.marker);
        activityPool.delete(id);
    });

    console.log(`🧹 Pool nettoyé : ${toEvict.length} activités évincées, ${activityPool.size} restantes`);
}

/**
 * Retourne (ou crée) le MarkerClusterGroup associé à une catégorie
 * @param {string} category
 * @returns {L.MarkerClusterGroup}
 */
function getOrCreateClusterGroup(category) {
    const key = category || 'autre';
    if (!categoryClusterGroups.has(key)) {
        const iconConfig = getIconConfig(key);
        const group = L.markerClusterGroup({
            maxClusterRadius: 60,
            disableClusteringAtZoom: 16,
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            iconCreateFunction: (cluster) => createClusterIcon(cluster, iconConfig)
        });
        group.addTo(map);
        categoryClusterGroups.set(key, group);
    }
    return categoryClusterGroups.get(key);
}

/**
 * Crée l'icône d'un cluster (même style que le marker individuel + compteur)
 */
function createClusterIcon(cluster, iconConfig) {
    const count = cluster.getChildCount();
    const fallbackIcon = iconConfig.icon || 'map-marker-alt';
    const iconHtml = iconConfig.svg
        ? `<img src="${iconConfig.svg}" alt="" style="width:18px;height:18px;filter:invert(1);">`
        : `<i class="fas fa-${fallbackIcon}" style="font-size:15px"></i>`;

    const COLORS = {
        blue:'#3b82f6', gray:'#6b7280', green:'#22c55e', red:'#ef4444',
        yellow:'#eab308', purple:'#a855f7', orange:'#f97316', pink:'#ec4899', cyan:'#06b6d4'
    };
    const bg = COLORS[iconConfig.color] || COLORS.blue;

    return L.divIcon({
        html: `<div class="activity-cluster-pin" style="background-color:${bg}">
                 ${iconHtml}
                 <span class="cluster-count">${count}</span>
               </div>`,
        className: 'custom-cluster',
        iconSize: [48, 48],
        iconAnchor: [24, 24]
    });
}

/**
 * Crée un marker pour une activité (version légère)
 * @param {Object} activity - Données de l'activité (version légère)
 * @param {boolean} addToCluster - Si false, ajoute directement à la carte (ex: search, favoris)
 * @returns {L.Marker} Le marker créé
 */
function createMarker(activity, addToCluster = true) {
    // Icône personnalisée selon la catégorie
    const iconConfig = getIconConfig(activity.category);
    
    const fallbackIcon = iconConfig.icon || 'map-marker-alt';
    const iconHtml = iconConfig.svg
        ? `<img src="${iconConfig.svg}" alt="" style="width:20px;height:20px;filter:invert(1);" onerror="this.style.display='none';this.nextElementSibling.style.display='inline';"><i class="fas fa-${fallbackIcon}" style="display:none"></i>`
        : `<i class="fas fa-${iconConfig.icon}"></i>`;

    const MARKER_COLORS = {
        blue:   '#476e99',
        gray:   '#a7a7a7',
        green:  '#58763a',
        red:    '#cf0a1d',
        yellow: '#fce883',
        purple: '#cc99ff',
        orange: '#fea347',
        pink:   '#e9ace9',
        cyan:   '#87d3f8',
    };
    const bgColor = MARKER_COLORS[iconConfig.color] || MARKER_COLORS.blue;

    const customIcon = L.divIcon({
        html: `<div class="activity-marker-pin" style="background-color:${bgColor}">${iconHtml}</div>`,
        className: 'custom-marker',
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        popupAnchor: [0, -20]
    });
    
    const marker = L.marker([activity.lat, activity.lng], { icon: customIcon });

    if (addToCluster) {
        getOrCreateClusterGroup(activity.category).addLayer(marker);
    } else {
        marker.addTo(map);
    }
    
    // Au clic sur le marker : centrer la carte puis afficher la fiche
    marker.on('click', async (e) => {
        L.DomEvent.stopPropagation(e);
        const zoom = Math.max(map.getZoom(), 15);
        const markerPoint = map.project([activity.lat, activity.lng], zoom);
        const offsetLatLng = map.unproject(markerPoint.add([0, computeMarkerOffset()]), zoom);
        map.setView(offsetLatLng, zoom);
        await loadAndShowActivityDetails(activity.id, marker);
    });
    
    return marker;
}

/**
 * Charge les détails d'une activité et affiche le popup
 * @param {number} activityId - ID de l'activité
 * @param {L.Marker} marker - Marker Leaflet
 */
/**
 * Affiche le panel activité avec le contenu HTML fourni
 * @param {string} html - Contenu HTML à injecter
 * @param {number} activityId - ID de l'activité affichée
 */
function showActivityPanel(html, activityId) {
    const panel   = document.getElementById('activity-panel');
    const content = document.getElementById('panel-content');
    if (!panel || !content) return;

    content.innerHTML = html;
    currentPanelActivityId = activityId;

    // Remettre en état compact à chaque nouvelle ouverture
    panel.classList.remove('panel-expanded');
    panel.classList.add('panel-open');
}

/**
 * Cache le panel activité
 */
function hideActivityPanel() {
    const panel = document.getElementById('activity-panel');
    if (!panel) return;
    panel.classList.remove('panel-open', 'panel-expanded');
    currentPanelActivityId = null;
}

/**
 * Initialise le drag handle du panel (toggle compact ↔ étendu)
 */
function initActivityPanel() {
    const panel  = document.getElementById('activity-panel');
    const handle = document.getElementById('panel-drag-handle');
    const close  = document.getElementById('panel-close');
    if (!panel) return;

    // Bouton fermer
    close?.addEventListener('click', hideActivityPanel);

    if (!handle) return;

    // ── Touch drag : glisser vers le haut pour étendre, vers le bas pour fermer ──
    let touchStartY = 0;
    let startExpanded = false;

    handle.addEventListener('touchstart', (e) => {
        touchStartY = e.touches[0].clientY;
        startExpanded = panel.classList.contains('panel-expanded');
    }, { passive: true });

    handle.addEventListener('touchend', (e) => {
        const delta = touchStartY - e.changedTouches[0].clientY; // positif = glisse vers le haut
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

    // Clic sur le handle = toggle compact / étendu (fallback desktop & tap rapide)
    handle.addEventListener('click', () => {
        panel.classList.toggle('panel-expanded');
    });
}

async function loadAndShowActivityDetails(activityId, marker) {
    try {
        console.log(`📄 Ouverture fiche activité #${activityId}`);

        // Si la fiche de cette activité est déjà ouverte, ne rien faire
        if (currentPanelActivityId === activityId) {
            console.log('✋ Fiche déjà ouverte, on ne fait rien');
            return;
        }

        // Afficher le loader dans le panel
        showActivityPanel(`<div class="popup-loading"><i class="fas fa-spinner fa-spin popup-loading-spinner"></i><p class="popup-loading-text">${T.LOADING}</p></div>`, activityId);

        // Charger les détails depuis l'API
        const details = await getActivityDetails(activityId);

        if (!details) {
            console.error(`❌ Impossible de charger #${activityId}`);
            showActivityPanel(`<div class="popup-error">${T.TOASTS.LOAD_ERROR}</div>`, activityId);
            return;
        }

        console.log(`✅ Fiche #${activityId} prête`);

        // Rendre le contenu complet dans le panel
        showActivityPanel(createPopupContent(details), activityId);

        // Configurer les événements des boutons
        setTimeout(() => setupPopupEventListeners(details), 10);

        // Enrichissement asynchrone Wikidata — fire & forget
        enrichPopupAsync(details.id, details);

    } catch (error) {
        console.error(`❌ Erreur fiche #${activityId}:`, error);
        showActivityPanel(`<div class="popup-error">${T.TOASTS.LOAD_ERROR}</div>`, activityId);
    }
}

/**
 * Dérive un nom de fichier depuis le type (ex. "laser game" → "laser-game", "nightclub" → "nightclub")
 * Convention béta : type = nom du SVG dans assets/icon/
 */
function typeToIconFilename(type) {
    if (!type) return 'autre';
    return type.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .trim().replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
}

/**
 * Couleurs des marqueurs par type d'activité.
 * Modifier ici pour changer la couleur d'un type (valeur = clé de MARKER_COLORS dans createMarker).
 * Types sans entrée utilisent la couleur 'blue' par défaut.
 */
const ICON_COLORS = {
    // Parcs & nature
    'parc':            'green',
    'golf':            'green',
    'accrobranche':    'green',
    'escalade':        'green',
    'randonnee':       'green',

    // Culture
    'musee':           'blue',
    'musée':           'blue',
    'castle':          'orange',
    'chateau':         'orange',

    // Sorties / loisirs
    'cinema':          'purple',
    'cinéma':          'purple',
    'escapegame':      'purple',
    'lasergame':       'purple',
    'bowling':         'purple',

    // Vie nocturne
    'nightclub':       'purple',
    'bar':             'purple',
    'queen':           'pink',

    // Sport & patinoire
    'iceskating':      'cyan',
    'piscine':         'cyan',

    // Autre
    'autre':           'gray',
};

/**
 * Retourne la configuration d'icône (svg + couleur) selon la catégorie.
 *
 * Convention SVG : assets/icon/<type-sans-accents>.svg
 * Pour changer la couleur d'un type → modifier ICON_COLORS ci-dessus.
 * Pour utiliser une icône Font Awesome au lieu d'un SVG → ajouter une entrée dans ICON_OVERRIDES.
 */
function getIconConfig(category) {
    const key = category?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const fileBase = typeToIconFilename(category);

    // Overrides : types qui utilisent une icône Font Awesome au lieu d'un SVG
    const ICON_OVERRIDES = {
        'autre': { icon: 'map-marker-alt', color: ICON_COLORS['autre'] || 'gray' }
    };
    const overrideKey = Object.keys(ICON_OVERRIDES).find(k =>
        k.normalize('NFD').replace(/[\u0300-\u036f]/g, '') === key
    );
    if (overrideKey) return ICON_OVERRIDES[overrideKey];

    // Couleur depuis la table, 'blue' par défaut
    const color = ICON_COLORS[key] || 'blue';

    return {
        svg: `assets/icon/${fileBase}.svg`,
        color
    };
}

/**
 * Récupère une image Wikidata et l'injecte dans le header du popup si disponible
 * @param {number} activityId
 * @param {string} wikidataId
 */
/**
 * Enrichit un popup de manière asynchrone avec les données Wikidata :
 * - Image (P18), avec fallback og:image sur le site web
 * - Description, adresse, téléphone, site web (si absents de la fiche)
 * @param {number} activityId
 * @param {Object} details - Données complètes de l'activité
 */
async function enrichPopupAsync(activityId, details) {
    console.log(`✨ Enrichissement popup #${activityId} — wikidata=${details.wikidata ?? 'aucun'}`);

    // 1. Récupérer toutes les données Wikidata en un seul appel
    let wikidataData = {};
    if (details.wikidata) {
        wikidataData = await getWikidataData(details.wikidata);
    }

    // 2. Image : priorité → champ image natif → Wikidata P18 → og:image
    let imageUrl = details.image || wikidataData.imageUrl || null;
    if (!imageUrl && details.website) {
        console.log(`🌐 Fallback og:image pour popup #${activityId}`);
        imageUrl = await getOgImage(details.website);
    }

    if (imageUrl) {
        const img = document.getElementById(`popup-header-img-${activityId}`);
        const header = document.getElementById(`popup-header-${activityId}`);
        // Guard : ne pas écraser une image déjà affichée (race condition entre deux enrichissements concurrents)
        if (img && header && !header.classList.contains('has-image') && !img.src) {
            img.onload = () => header.classList.add('has-image');
            img.onerror = () => console.warn(`⚠️ Image non chargeable pour popup #${activityId}`);
            img.src = imageUrl;
        }
    }

    // 3. Champs texte : n'enrichir que les champs absents de la fiche originale

    // Description
    if (!details.description && wikidataData.description) {
        const el = document.getElementById(`popup-desc-${activityId}`);
        const block = document.getElementById(`popup-info-${activityId}`);
        if (el) {
            el.textContent = wikidataData.description;
            el.style.display = '';
            if (block) block.style.display = '';
            console.log(`📝 Description Wikidata injectée dans popup #${activityId}`);
        }
    }

    // Adresse
    if (!details.address && wikidataData.address) {
        const el = document.getElementById(`popup-addr-${activityId}`);
        const block = document.getElementById(`popup-info-${activityId}`);
        if (el) {
            const span = el.querySelector('span');
            if (span) span.textContent = wikidataData.address;
            el.style.display = '';
            if (block) block.style.display = '';
            console.log(`📍 Adresse Wikidata injectée dans popup #${activityId}`);
        }
    }

    // Site web
    if (!details.website && wikidataData.website) {
        const el = document.getElementById(`popup-web-${activityId}`);
        const block = document.getElementById(`popup-links-${activityId}`);
        if (el) {
            el.href = wikidataData.website;
            el.style.display = '';
            if (block) block.style.display = '';
            console.log(`🌐 Site web Wikidata injecté dans popup #${activityId}`);
        }
    }

    // Téléphone
    if (!details.phone && wikidataData.phone) {
        const el = document.getElementById(`popup-phone-${activityId}`);
        const block = document.getElementById(`popup-links-${activityId}`);
        if (el) {
            el.href = `tel:${wikidataData.phone}`;
            const span = el.querySelector('span');
            if (span) span.textContent = wikidataData.phone;
            el.style.display = '';
            if (block) block.style.display = '';
            console.log(`📞 Téléphone Wikidata injecté dans popup #${activityId}`);
        }
    }
}

/**
 * Crée le contenu HTML du popup
 * @param {Object} activity - Données complètes de l'activité
 * @returns {string} HTML du popup
 */
/**
 * Échappe les caractères HTML dangereux pour prévenir les injections XSS
 */
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Retourne le HTML du badge de note moyenne (coloré selon la valeur)
 * @param {number|null} avg
 * @param {number} total
 */
function _ratingBadgeHtml(avg, total) {
    if (!avg || total === 0) return '';
    const cls = avg >= 4 ? 'rating-badge-green' : avg >= 3 ? 'rating-badge-orange' : 'rating-badge-red';
    return `<span class="rating-badge ${cls}" title="${total} avis">★ ${avg}</span>`;
}

/**
 * Retourne le HTML de la section notation (5 boutons rectangulaires)
 * @param {number|null} userRating — note actuelle de l'utilisateur (ou null)
 * @param {number} activityId
 */
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
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '-');
    
    const safeTitle    = escapeHtml(activity.title);
    const safeCategory = escapeHtml(activity.category || T.LABELS.CATEGORY_OTHER);
    const safeAddress  = escapeHtml(activity.address || '');
    const safeDesc     = escapeHtml(activity.description || '');
    const safePhone    = escapeHtml(activity.phone || '');
    const safeWebsite  = activity.website && /^https?:\/\//i.test(activity.website)
        ? escapeHtml(activity.website) : '';

    // Badge note moyenne (sera rechargé de façon async après)
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

            <!-- Notation -->
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

/**
 * Configure les événements des boutons du popup
 * @param {Object} activity - Données de l'activité
 */
function setupPopupEventListeners(activity) {
    // Bouton favoris (auth obligatoire, géré via API)
    const favoriteBtn = document.querySelector('[data-action="favorite"]');
    if (favoriteBtn) {
        favoriteBtn.addEventListener('click', () => {
            toggleFavorite(activity.id, {
                id: activity.id,
                name: activity.title,
                lat: activity.lat,
                lng: activity.lng,
                type: activity.category
            });
        });
    }
    
    // Bouton à faire (toggle)
    const todoBtn = document.querySelector('[data-action="todo"]');
    if (todoBtn) {
        todoBtn.addEventListener('click', () => {
            onAuthRequired(async () => {
                try {
                    const isActive = todoBtn.classList.contains('active');
                    const method = isActive ? 'DELETE' : 'POST';
                    const res = await _authFetch(`${getApiBaseUrl()}/users/me/todo/${activity.id}`, { method });
                    const data = await res.json();
                    if (data.success) {
                        const nowActive = !isActive;
                        _updateTodoBtn(activity.id, nowActive);
                    }
                    showToast(data.message || (isActive ? T.TOASTS.TODO_REMOVED : T.TOASTS.TODO_ADDED), data.success ? 'success' : 'error');
                } catch {
                    showToast(T.TOASTS.NETWORK_ERROR, 'error');
                }
            });
        });
    }

    loadUserTodoStatus(activity.id);

    // Bouton itinéraire
    const itineraryBtn = document.querySelector('[data-action="itinerary"]');
    if (itineraryBtn) {
        itineraryBtn.addEventListener('click', () => openItinerary(activity.lat, activity.lng));
    }
    
    // Bouton similaires
    const similarBtn = document.querySelector('[data-action="similar"]');
    if (similarBtn) {
        similarBtn.addEventListener('click', () => showSimilarActivities(activity.category));
    }

    // Bouton partager
    const shareBtn = document.querySelector('[data-action="share"]');
    if (shareBtn) {
        shareBtn.addEventListener('click', () => shareActivity(activity.id, activity.title));
    }

    // Boutons notation
    document.querySelectorAll(`[data-action="rate"][data-id="${activity.id}"]`).forEach(btn => {
        btn.addEventListener('click', () => {
            const value = parseInt(btn.dataset.value);
            onAuthRequired(() => submitRating(activity.id, value));
        });
    });

    // Charger la note actuelle de l'utilisateur en async
    loadUserRating(activity.id);
}

/**
 * Met à jour visuellement le bouton "À faire"
 */
function _updateTodoBtn(activityId, isInTodo) {
    const btn = document.getElementById(`todo-btn-${activityId}`);
    if (!btn) return;
    btn.classList.toggle('active', isInTodo);
    const icon = btn.querySelector('i');
    if (icon) icon.className = isInTodo ? 'fas fa-clipboard-check' : 'fas fa-clipboard-list';
    const label = btn.querySelector('span');
    if (label) label.textContent = isInTodo ? T.BUTTONS.TODO_CHECKED : T.BUTTONS.TODO;
}

/**
 * Charge le statut "à faire" de l'utilisateur pour une activité
 */
async function loadUserTodoStatus(activityId) {
    try {
        const token = typeof getAuthToken === 'function' ? getAuthToken() : null;
        if (!token) return;
        const res = await fetch(`${API_BASE_URL}/users/me/todo/${activityId}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.inTodo) _updateTodoBtn(activityId, true);
    } catch {}
}

/**
 * Charge la note de l'utilisateur pour une activité et met à jour l'UI
 */
async function loadUserRating(activityId) {
    try {
        const token  = typeof getAuthToken === 'function' ? getAuthToken() : null;
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const res    = await fetch(`${API_BASE_URL}/ratings/activity/${activityId}`, { headers });
        if (!res.ok) return;
        const data = await res.json();

        // Mettre à jour le badge de note moyenne
        if (data.average) {
            const badgeEl = document.getElementById(`rating-avg-badge-${activityId}`);
            if (badgeEl) {
                const cls = data.average >= 4 ? 'rating-badge-green' : data.average >= 3 ? 'rating-badge-orange' : 'rating-badge-red';
                badgeEl.innerHTML = `<span class="rating-badge ${cls}" title="${data.totalVotes} avis">★ ${data.average}</span>`;
            }
        }

        // Marquer le bouton actif selon la note de l'utilisateur
        if (data.userRating) {
            _updateRatingBar(activityId, data.userRating);
        }
    } catch {}
}

/**
 * Envoie une note au serveur et met à jour l'UI
 */
async function submitRating(activityId, value) {
    try {
        const token = typeof getAuthToken === 'function' ? getAuthToken() : null;
        if (!token) return;

        const res  = await fetch(`${API_BASE_URL}/ratings`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body:    JSON.stringify({ activityId, value })
        });
        const data = await res.json();
        if (!data.success) { showToast(data.message || T.TOASTS.ERROR, 'error'); return; }

        _updateRatingBar(activityId, value);

        // Mettre à jour le badge moyenne
        if (data.average) {
            const badgeEl = document.getElementById(`rating-avg-badge-${activityId}`);
            if (badgeEl) {
                const cls = data.average >= 4 ? 'rating-badge-green' : data.average >= 3 ? 'rating-badge-orange' : 'rating-badge-red';
                badgeEl.innerHTML = `<span class="rating-badge ${cls}" title="${data.totalVotes} avis">★ ${data.average}</span>`;
            }
        }

        showToast(T.TOASTS.RATING_SUCCESS(T.RATING_LABELS[value]), 'success');
    } catch {
        showToast(T.TOASTS.NETWORK_ERROR, 'error');
    }
}

/**
 * Met à jour visuellement la barre de notation
 */
function _updateRatingBar(activityId, selectedValue) {
    const bar = document.getElementById(`rating-bar-${activityId}`);
    if (!bar) return;
    bar.querySelectorAll('.rating-btn').forEach(btn => {
        btn.classList.toggle('rating-btn-active', parseInt(btn.dataset.value) === selectedValue);
    });
}

/**
 * Ajoute ou retire une activité des favoris (via API, auth obligatoire)
 */
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
                            id: source.id,
                            name: source.name || source.title,
                            lat: source.lat,
                            lng: source.lng,
                            type: source.type || source.category
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

/**
 * Ouvre l'itinéraire Google Maps
 * @param {number} destLat - Latitude de destination
 * @param {number} destLng - Longitude de destination
 */
function openItinerary(destLat, destLng) {
    const pos = userMarker.getLatLng();
    const url = `https://www.google.com/maps/dir/?api=1&origin=${pos.lat},${pos.lng}&destination=${destLat},${destLng}&travelmode=driving`;
    window.open(url, '_blank');
}

/**
 * Affiche les activités similaires
 * @param {string} category - Catégorie de l'activité
 */
function showSimilarActivities(category) {
    showToast(T.TOASTS.SIMILAR_SOON, 'info');
}

/**
 * Partage une activité via Web Share API ou copie le lien dans le presse-papier
 * @param {number} activityId
 * @param {string} title
 */
async function shareActivity(activityId, title) {
    const url = `${window.location.origin}${window.location.pathname}?activity=${activityId}`;
    if (navigator.share) {
        try {
            await navigator.share({ title, url });
        } catch (e) {
            // Annulation silencieuse (l'utilisateur a fermé le menu de partage)
        }
    } else {
        try {
            await navigator.clipboard.writeText(url);
            showToast(T.TOASTS.LINK_COPIED, 'success');
        } catch {
            // Fallback si clipboard indisponible
            showToast(T.TOASTS.LINK_FALLBACK(url), 'info');
        }
    }
}

/**
 * Gère l'ouverture directe d'une activité via l'URL ?activity=ID
 * Appelé au chargement de la page.
 */
async function handleDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const activityId = parseInt(params.get('activity'));
    if (!activityId) return;

    // Nettoyer l'URL sans recharger la page
    history.replaceState({}, '', window.location.pathname);

    console.log(`🔗 Deep link détecté : activité #${activityId}`);

    const details = await getActivityDetails(activityId);
    if (!details || !details.lat) {
        showToast(T.TOASTS.ACTIVITY_NOT_FOUND, 'info');
        return;
    }

    // Créer ou récupérer le marker
    let poolEntry = activityPool.get(activityId);
    let marker;
    if (poolEntry) {
        marker = poolEntry.marker;
    } else {
        const activity = { id: activityId, lat: details.lat, lng: details.lng, category: details.category };
        marker = createMarker(activity, false);
        activityPool.set(activityId, { activity, marker });
    }

    // Centrer la carte : marker dans la zone visible optimale (haut sur mobile)
    const zoom = Math.max(map.getZoom(), 15);
    const markerPoint = map.project([details.lat, details.lng], zoom);
    const offsetLatLng = map.unproject(markerPoint.add([0, computeMarkerOffset()]), zoom);
    map.setView(offsetLatLng, zoom);

    await loadAndShowActivityDetails(activityId, marker);
}

/**
 * Récupère les favoris depuis le cache local (synchronisé avec l'API)
 */
function getFavorites() {
    return _favoritesCache;
}

/**
 * Vérifie si une activité est dans les favoris
 */
function isActivityFavorite(activityId) {
    return _favoritesCache.some(f => f.id === activityId);
}

/**
 * Met à jour le badge de compteur favoris sur le bouton flottant
 */
function updateFavoritesCount() {
    const badge = document.getElementById('favCount');
    if (!badge) return;
    const count = _favoritesCache.length;
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
}

let _favPanelOpen = false;

/**
 * Génère le HTML de la liste de favoris
 */
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

/**
 * Affiche le panel favoris dédié
 */
function showFavoritesPanel() {
    const panel   = document.getElementById('favorites-panel');
    const content = document.getElementById('fav-panel-content');
    if (!panel || !content) return;

    // Sur mobile : fermer la fiche activité si ouverte, avec une petite pause pour animer
    const isMobile = window.innerWidth < 768;
    if (isMobile && currentPanelActivityId !== null) {
        hideActivityPanel();
        setTimeout(() => {
            _openFavPanel(panel, content);
        }, 200);
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

/**
 * Attache les événements de la liste favoris
 */
function _bindFavoritesEvents() {
    const content = document.getElementById('fav-panel-content');
    if (!content) return;

    content.querySelectorAll('.fav-item[data-lat]').forEach(el => {
        el.addEventListener('click', (e) => {
            if (e.target.closest('.remove-favorite')) return;

            const lat = parseFloat(el.dataset.lat);
            const lng = parseFloat(el.dataset.lng);
            const id  = parseInt(el.dataset.id);

            // Centrer la carte sur l'activité
            const zoom = Math.max(map.getZoom(), 15);
            const markerPoint = map.project([lat, lng], zoom);
            const offsetLatLng = map.unproject(markerPoint.add([0, computeMarkerOffset()]), zoom);
            map.setView(offsetLatLng, zoom);
        });
    });

    content.querySelectorAll('.remove-favorite').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFavorite(parseInt(btn.dataset.id));
        });
    });
}

/**
 * Rafraîchit le contenu du panel favoris s'il est ouvert
 */
function _refreshFavPanel() {
    if (!_favPanelOpen) return;
    const content = document.getElementById('fav-panel-content');
    if (!content) return;
    content.innerHTML = _buildFavoritesListHtml();
    _bindFavoritesEvents();
}

/**
 * Ferme le panel favoris
 */
function hideFavoritesPanel() {
    _favPanelOpen = false;
    const panel = document.getElementById('favorites-panel');
    if (panel) panel.classList.remove('panel-open', 'panel-expanded');
}

/**
 * Initialise le drag handle et le bouton close du panel favoris
 */
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
        if (delta > 40) {
            panel.classList.add('panel-expanded');
        } else if (delta < -40) {
            if (startExpanded) {
                panel.classList.remove('panel-expanded');
            } else {
                hideFavoritesPanel();
            }
        }
    }, { passive: true });

    handle.addEventListener('click', () => {
        panel.classList.toggle('panel-expanded');
    });
}

/**
 * Affiche une notification toast
 * @param {string} message - Message à afficher
 * @param {string} type - Type de notification ('success', 'error', 'info')
 */
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');

    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        info: 'fa-info-circle'
    };

    toast.className = `toast-${type}`;
    toastMessage.innerHTML = `<i class="fas ${icons[type]}"></i>${message}`;

    toast.style.transform = 'translateX(-50%) translateY(0)';

    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
        toast.style.transform = 'translateX(-50%) translateY(-8rem)';
    }, 3000);
}

/**
 * Filtre les activités selon le terme de recherche
 * @param {string} searchTerm - Terme de recherche
 */
/**
 * Active le mode recherche : masque le pool, affiche uniquement les résultats
 * @param {Array} results - Activités trouvées
 */
function enterSearchMode(results) {
    isSearchMode = true;
    // Masquer tous les cluster groups
    categoryClusterGroups.forEach(group => { if (map.hasLayer(group)) map.removeLayer(group); });
    // Supprimer les anciens markers de recherche
    searchMarkers.forEach(({ marker }) => map.removeLayer(marker));
    searchMarkers = [];
    // Créer les markers de recherche directement sur la carte (sans clustering)
    results.forEach(activity => {
        const marker = createMarker(activity, false);
        searchMarkers.push({ marker, activity });
    });
}

/**
 * Quitte le mode recherche : restaure le pool et recharge le viewport
 */
function exitSearchMode() {
    isSearchMode = false;
    searchMarkers.forEach(({ marker }) => map.removeLayer(marker));
    searchMarkers = [];
    // Réafficher tous les cluster groups
    categoryClusterGroups.forEach(group => { if (!map.hasLayer(group)) group.addTo(map); });
    loadActivitiesInViewport();
}

async function searchActivities(searchTerm) {
    if (!searchTerm || searchTerm.trim() === '') {
        exitSearchMode();
        return;
    }

    const term = searchTerm.trim();
    console.log(`🔍 Recherche globale côté serveur pour "${term}"`);
    const userPos = userMarker.getLatLng();
    const results = await searchActivitiesGlobal(term, userPos.lat, userPos.lng);

    enterSearchMode(results);

    if (results.length === 0) {
        showToast(T.TOASTS.SEARCH_NO_RESULTS(term), 'info');
    } else {
        showToast(T.TOASTS.SEARCH_RESULTS(results.length), 'success');
        await centerOnSearchResults(results);
    }
}

/**
 * Centre la carte sur les résultats de recherche
 * - 1 résultat : centrage avec offset et ouverture du popup
 * - Plusieurs résultats : fitBounds pour englober tous les markers visibles
 * @param {Array} results - Liste des activités trouvées
 */
async function centerOnSearchResults(results) {
    if (results.length === 1) {
        const activity = results[0];
        const zoom = Math.max(map.getZoom(), 15);
        const markerPoint = map.project([activity.lat, activity.lng], zoom);
        const offsetLatLng = map.unproject(markerPoint.add([0, computeMarkerOffset()]), zoom);
        map.setView(offsetLatLng, zoom);

        const entry = searchMarkers.find(e =>
            Math.abs(e.activity.lat - activity.lat) < 0.0001 &&
            Math.abs(e.activity.lng - activity.lng) < 0.0001
        );
        if (entry) {
            await loadAndShowActivityDetails(activity.id, entry.marker);
        }
    } else {
        const bounds = L.latLngBounds(results.map(a => [a.lat, a.lng]));
        map.fitBounds(bounds, {
            padding: [60, 60],
            maxZoom: 14
        });
    }
}

/**
 * Bloque le zoom natif du navigateur (pinch, double-tap) et tout scroll
 * de page hors de la carte Leaflet. Recentre immédiatement si le scroll
 * s'échappe (comportement type CityMapper).
 */
function lockViewport() {
    // Empêche le pinch-to-zoom multi-touch
    document.addEventListener('touchstart', (e) => {
        if (e.touches.length > 1) e.preventDefault();
    }, { passive: false });

    // Empêche les gestes Safari (gesturestart / gesturechange)
    document.addEventListener('gesturestart',  (e) => e.preventDefault(), { passive: false });
    document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });

    // Si le scroll s'échappe malgré tout, on recentre immédiatement
    window.addEventListener('scroll', () => window.scrollTo(0, 0), { passive: true });
}

/**
 * Initialisation de l'application au chargement de la page
 */
document.addEventListener('DOMContentLoaded', () => {
    checkStorageVersion();
    lockViewport();
    initMap();
    initStylePicker();
    initActivityPanel();
    initFavoritesPanel();
    handleDeepLink();
    loadFavorites();
    
    // Bouton flottant favoris
    const favToggle = document.getElementById('fav-picker-toggle');
    if (favToggle) {
        favToggle.addEventListener('click', () => {
            if (_favPanelOpen) {
                hideFavoritesPanel();
            } else {
                showFavoritesPanel();
            }
        });
    }
    
    // Configuration de la barre de recherche
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        let searchTimeout;
        searchInput.addEventListener('input', (e) => {
            const val = e.target.value;
            clearTimeout(searchTimeout);
            // Recherche déclenchée seulement à partir de 4 caractères (ou vide pour réinitialiser)
            if (val.length > 0 && val.trim().length < 4) return;
            searchTimeout = setTimeout(() => {
                searchActivities(val);
            }, 300);
        });
        
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                clearTimeout(searchTimeout);
                searchActivities(e.target.value);
            }
        });

    }
    
    // ── Raccourcis clavier ────────────────────────────────────────────
    document.addEventListener('keydown', (e) => {
        const tag = document.activeElement?.tagName;
        const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;

        // / → focus barre de recherche
        if (e.key === '/' && !isTyping) {
            e.preventDefault();
            searchInput?.focus();
            searchInput?.select();
            return;
        }

        // Échap → fermer favoris, fiche, puis recherche
        if (e.key === 'Escape') {
            if (_favPanelOpen) {
                hideFavoritesPanel();
            } else if (currentPanelActivityId !== null) {
                hideActivityPanel();
            } else if (isSearchMode && searchInput) {
                searchInput.value = '';
                exitSearchMode();
            }
            return;
        }

        // F → ouvrir / fermer les favoris
        if ((e.key === 'f' || e.key === 'F') && !isTyping) {
            if (_favPanelOpen) {
                hideFavoritesPanel();
            } else {
                showFavoritesPanel();
            }
            return;
        }
    });
});
