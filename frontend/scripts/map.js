/**
 * Module Carte - Gestion de la carte Leaflet et des interactions
 */

// Version du localStorage — à incrémenter lors d'un changement de DB ou de format de données
const STORAGE_VERSION = '1';

/**
 * Vérifie la version du localStorage et purge les données si obsolètes
 */
function checkStorageVersion() {
    const stored = localStorage.getItem('storage_version');
    if (stored !== STORAGE_VERSION) {
        console.warn(`🗑️ LocalStorage obsolète (v${stored} → v${STORAGE_VERSION}), purge...`);
        localStorage.removeItem('favorites');
        localStorage.removeItem('user_position');
        localStorage.setItem('storage_version', STORAGE_VERSION);
    }
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
        label: 'Papillon',
        url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png',
        options: { subdomains: 'abcd' }
    },
    satellite: {
        label: 'Satellite',
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        options: { maxZoom: 19 }
    },
    nuit: {
        label: 'Nuit',
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        options: { subdomains: 'abcd' }
    },
    simple: {
        label: 'Simple',
        url: `https://tile.jawg.io/jawg-streets/{z}/{x}/{y}{r}.png?access-token=${JAWG_TOKEN}`,
        options: {}
    },
    propre: {
        label: 'Propre',
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
    defaultRadiusMeters: 5000, // Rayon par défaut de 5km
    minRadiusMeters: 500, // Rayon minimum de 500m
    maxRadiusMeters: 50000 // Rayon maximum de 50km
};

// Variables globales
let map;
let currentTileLayer = null;
let currentStyleKey = 'papillon';
const activityPool = new Map();           // id → { activity, marker }
const categoryClusterGroups = new Map();  // category → MarkerClusterGroup
const MAX_POOL = 400;
let searchMarkers = [];
let isSearchMode = false;
let lastLoadedBounds = null;  // Bounds lors du dernier chargement (avec padding)
let lastLoadedZoom = null;    // Zoom lors du dernier chargement
let viewportLoadTimeout = null; // Debounce du rechargement viewport
let userMarker;
let userCircle;
let resizeHandle;
let userPosition = MAP_CONFIG.center;
let currentRadius = MAP_CONFIG.defaultRadiusMeters;
let circleEnabled = false;
let isResizingCircle = false;
let radiusTooltip;

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
        showToast('Ajoutez votre token Jawg dans map.js (JAWG_TOKEN)', 'info');
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
function initStylePicker() {
    const toggle = document.getElementById('style-picker-toggle');
    const panel  = document.getElementById('style-picker-panel');
    if (!toggle || !panel) return;

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
        attributionControl: false
    }).setView(userPosition, MAP_CONFIG.zoom);

    // Appliquer le style sauvegardé (ou papillon par défaut)
    const savedStyle = localStorage.getItem('map_style') || 'papillon';
    setMapStyle(savedStyle, false);
    
    createUserMarker();
    createRadiusTooltip();

    map.on('moveend', () => {
        if (isSearchMode) return;
        clearTimeout(viewportLoadTimeout);
        viewportLoadTimeout = setTimeout(loadActivitiesInViewport, 400);
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
            if (userCircle) userCircle.setLatLng(userPosition);
            if (resizeHandle) updateHandlePosition();
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
 * Crée l'infobulle pour afficher la distance du rayon
 */
function createRadiusTooltip() {
    radiusTooltip = L.tooltip({
        permanent: false,
        direction: 'top',
        className: 'radius-tooltip',
        offset: [0, -10]
    });
}

/**
 * Crée le marqueur de position utilisateur avec cercle de rayon
 */
function createUserMarker() {
    // Création du cercle de rayon (si activé)
    if (circleEnabled) {
        userCircle = L.circle(userPosition, {
            color: 'rgba(59, 130, 246, 0.4)',
            fillColor: 'rgba(59, 130, 246, 0.08)',
            fillOpacity: 1,
            radius: currentRadius,
            weight: 2,
            className: 'user-radius-circle'
        }).addTo(map);
        
        // Créer le handle de redimensionnement
        createResizeHandle();
    }
    
    // Création du marqueur utilisateur draggable (you.svg, jaune, au-dessus des autres points)
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
    
    // Événement de déplacement du marqueur
    userMarker.on('drag', function(e) {
        const newPos = e.target.getLatLng();
        userPosition = [newPos.lat, newPos.lng];
        
        // Mettre à jour la position du cercle ET du handle même si désactivé
        if (userCircle) {
            userCircle.setLatLng(newPos);
        }
        if (resizeHandle) {
            updateHandlePosition();
        }
    });
    
    // Événement de fin de déplacement du marqueur utilisateur
    userMarker.on('dragend', function(e) {
        const newPos = e.target.getLatLng();
        userPosition = [newPos.lat, newPos.lng];
        saveUserPosition(newPos.lat, newPos.lng); // Mémoriser la nouvelle position
    });
    
    // Événement de clic sur le marqueur : toggle du cercle
    userMarker.on('click', toggleCircle);
}

/**
 * Crée le handle (poignée) de redimensionnement du rayon
 */
function createResizeHandle() {
    if (!circleEnabled) return;
    
    // Calculer la position du handle (à droite du cercle)
    const center = L.latLng(userPosition);
    const handlePos = calculateHandlePosition(center, currentRadius);
    
    // Créer le handle avec une icône personnalisée
    const handleIcon = L.divIcon({
        html: '<div class="resize-handle"><div class="resize-handle-inner"></div></div>',
        className: 'resize-handle-container',
        iconSize: [50, 32],
        iconAnchor: [25, 16]
    });
    
    resizeHandle = L.marker(handlePos, {
        icon: handleIcon,
        draggable: true,
        zIndexOffset: 3000
    }).addTo(map);
    
    // Désactiver les interactions avec la carte pendant le drag
    resizeHandle.on('mousedown', function(e) {
        L.DomEvent.stopPropagation(e);
        map.dragging.disable();
        map.doubleClickZoom.disable();
        map.scrollWheelZoom.disable();
        
        // Afficher l'infobulle
        const radiusKm = (currentRadius / 1000).toFixed(1);
        radiusTooltip
            .setLatLng(handlePos)
            .setContent(`${radiusKm} km`)
            .addTo(map);
    });
    
    // Pendant le drag, mettre à jour le rayon
    resizeHandle.on('drag', function(e) {
        const handleLatLng = e.target.getLatLng();
        const center = L.latLng(userPosition);
        
        // Calculer le nouveau rayon
        const newRadius = calculateDistance(
            center.lat, center.lng,
            handleLatLng.lat, handleLatLng.lng
        );
        
        // Limiter le rayon entre min et max
        currentRadius = Math.max(
            MAP_CONFIG.minRadiusMeters,
            Math.min(MAP_CONFIG.maxRadiusMeters, newRadius)
        );
        
        // Mettre à jour le cercle
        if (userCircle) {
            userCircle.setRadius(currentRadius);
        }
        
        // Repositionner le handle exactement à droite
        updateHandlePosition();
        
        // Mettre à jour l'infobulle
        const radiusKm = (currentRadius / 1000).toFixed(1);
        radiusTooltip.setContent(`${radiusKm} km`);
    });
    
    // Fin du drag
    resizeHandle.on('dragend', function(e) {
        map.dragging.enable();
        map.doubleClickZoom.enable();
        map.scrollWheelZoom.enable();
        
        // Masquer l'infobulle
        if (map.hasLayer(radiusTooltip)) {
            map.removeLayer(radiusTooltip);
        }
        
        // Le viewport ne change pas lors du resize du cercle, pas de rechargement
    });
}

/**
 * Calcule la position du handle (sur la bordure droite du cercle)
 */
function calculateHandlePosition(center, radius) {
    // Calculer la position exacte sur la bordure du cercle à droite
    // en utilisant la formule de conversion rayon -> degrés de longitude
    const radiusInDegrees = (radius / 111320) / Math.cos(center.lat * Math.PI / 180);
    return L.latLng(center.lat, center.lng + radiusInDegrees);
}

/**
 * Met à jour la position du handle
 */
function updateHandlePosition() {
    if (resizeHandle && userCircle) {
        const center = L.latLng(userPosition);
        const handlePos = calculateHandlePosition(center, currentRadius);
        resizeHandle.setLatLng(handlePos);
        
        // Mettre à jour l'infobulle si elle est visible
        if (map.hasLayer(radiusTooltip)) {
            radiusTooltip.setLatLng(handlePos);
        }
    }
}

/**
 * Active/désactive le cercle de recherche au clic sur le marqueur
 */
function toggleCircle(e) {
    L.DomEvent.stopPropagation(e); // Empêcher la propagation du clic
    
    circleEnabled = !circleEnabled;
    
    if (circleEnabled) {
        // Réactiver le cercle
        if (!userCircle) {
            userCircle = L.circle(userPosition, {
                color: 'rgba(59, 130, 246, 0.4)',
                fillColor: 'rgba(59, 130, 246, 0.08)',
                fillOpacity: 1,
                radius: currentRadius,
                weight: 2,
                className: 'user-radius-circle'
            }).addTo(map);
        } else {
            // Mettre à jour la position avant de réafficher
            userCircle.setLatLng(L.latLng(userPosition));
            userCircle.addTo(map);
        }
        
        // Créer ou réafficher le handle
        if (!resizeHandle) {
            createResizeHandle();
        } else {
            resizeHandle.addTo(map);
            updateHandlePosition();
        }
        
        showToast(`Recherche limitée à ${(currentRadius / 1000).toFixed(1)} km`, 'info');
    } else {
        // Désactiver le cercle
        if (userCircle && map.hasLayer(userCircle)) {
            map.removeLayer(userCircle);
        }
        
        // Masquer le handle
        if (resizeHandle && map.hasLayer(resizeHandle)) {
            map.removeLayer(resizeHandle);
        }
        
        showToast('Recherche sans limite de distance', 'info');
    }
    // Le chargement est piloté par viewport, pas par le cercle
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
        blue:   '#3b82f6',
        gray:   '#6b7280',
        green:  '#22c55e',
        red:    '#ef4444',
        yellow: '#eab308',
        purple: '#a855f7',
        orange: '#f97316',
        pink:   '#ec4899',
        cyan:   '#06b6d4',
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
    
    // Au clic sur le marker, charger et afficher les détails
    marker.on('click', async () => {
        await loadAndShowActivityDetails(activity.id, marker);
    });
    
    return marker;
}

/**
 * Charge les détails d'une activité et affiche le popup
 * @param {number} activityId - ID de l'activité
 * @param {L.Marker} marker - Marker Leaflet
 */
async function loadAndShowActivityDetails(activityId, marker) {
    try {
        console.log(`📄 Ouverture popup activité #${activityId}`);
        
        // Si le popup est déjà ouvert, ne rien faire
        if (marker.isPopupOpen()) {
            console.log('✋ Popup déjà ouvert, on ne fait rien');
            return;
        }
        
        // Vérifier si le popup existe déjà
        const existingPopup = marker.getPopup();
        console.log(`🔍 Popup existant: ${existingPopup ? 'OUI' : 'NON'}`);
        
        // Créer ou récupérer le popup
        if (!existingPopup) {
            console.log('🆕 Création nouveau popup');
            const loadingPopup = L.popup()
                .setContent('<div class="popup-loading"><i class="fas fa-spinner fa-spin popup-loading-spinner"></i><p class="popup-loading-text">Chargement...</p></div>');
            marker.bindPopup(loadingPopup);
        } else {
            console.log('♻️ Réutilisation popup existant');
            marker.setPopupContent('<div class="popup-loading"><i class="fas fa-spinner fa-spin popup-loading-spinner"></i><p class="popup-loading-text">Chargement...</p></div>');
        }
        
        // IMPORTANT: Toujours ouvrir le popup
        marker.openPopup();
        console.log('👁️ Popup ouvert');
        
        // Charger les détails depuis l'API
        const details = await getActivityDetails(activityId);
        
        if (!details) {
            console.error(`❌ Impossible de charger #${activityId}`);
            marker.setPopupContent('<div class="popup-error">Erreur lors du chargement</div>');
            return;
        }
        
        console.log(`✅ Popup #${activityId} prêt`);
        
        // Créer le contenu du popup avec les détails
        const popupContent = createPopupContent(details);
        
        // Mettre à jour le popup avec le contenu complet
        marker.setPopupContent(popupContent);
        
        // Vérifier si le popup est toujours ouvert
        if (!marker.isPopupOpen()) {
            console.warn('⚠️ Popup fermé, réouverture...');
            marker.openPopup();
        }
        
        // Configurer les événements des boutons
        setTimeout(() => {
            setupPopupEventListeners(details);
        }, 10);

        // Enrichissement asynchrone depuis Wikidata (image + texte) — fire & forget
        enrichPopupAsync(details.id, details);
        
    } catch (error) {
        console.error(`❌ Erreur popup #${activityId}:`, error);
        if (marker.getPopup()) {
            marker.setPopupContent('<div class="popup-error">Erreur lors du chargement</div>');
        }
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

function createPopupContent(activity) {
    const isFavorite = isActivityFavorite(activity.id);
    const favoriteClass = isFavorite ? 'active' : '';
    const favoriteIcon = isFavorite ? 'fa-solid' : 'fa-regular';
    
    // Nettoyer le nom de catégorie pour créer une classe CSS valide
    const categoryClass = (activity.category || 'autre')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Retirer les accents
        .replace(/\s+/g, '-'); // Remplacer les espaces par des tirets
    
    const safeTitle    = escapeHtml(activity.title);
    const safeCategory = escapeHtml(activity.category || 'Autre');
    const safeAddress  = escapeHtml(activity.address || '');
    const safeDesc     = escapeHtml(activity.description || '');
    const safePhone    = escapeHtml(activity.phone || '');
    // website : on vérifie que c'est bien une URL http(s) avant de l'utiliser
    const safeWebsite  = activity.website && /^https?:\/\//i.test(activity.website)
        ? escapeHtml(activity.website) : '';

    return `
        <div class="popup-content">
            <div class="popup-header" id="popup-header-${activity.id}">
                <img class="popup-header-img" id="popup-header-img-${activity.id}" alt="" aria-hidden="true">
                <div class="popup-header-text">
                    <h3 class="popup-title">${safeTitle}</h3>
                    <span class="category-badge category-${categoryClass}">${safeCategory}</span>
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
                        <span class="popup-link-label">Visiter le site web</span>
                    </a>
                    <a href="tel:${safePhone}" class="popup-link" id="popup-phone-${activity.id}"${!activity.phone ? ' style="display:none"' : ''}>
                        <i class="fas fa-phone"></i>
                        <span>${safePhone}</span>
                    </a>
                </div>
            </div>

            <div class="popup-footer">
                <button class="popup-btn btn-favorite ${favoriteClass}" data-action="favorite" data-id="${activity.id}">
                    <i class="${favoriteIcon} fa-heart"></i>
                    <span>${isFavorite ? 'Favori' : 'Ajouter'}</span>
                </button>

                <button class="popup-btn btn-itinerary" data-action="itinerary" data-id="${activity.id}">
                    <i class="fas fa-route"></i>
                    <span>Itinéraire</span>
                </button>

                <button class="popup-btn btn-similar" data-action="similar" data-id="${activity.id}">
                    <i class="fas fa-search"></i>
                    <span>Similaires</span>
                </button>

                <button class="popup-btn btn-share" data-action="share" data-id="${activity.id}" data-title="${escapeHtml(activity.title)}">
                    <i class="fas fa-share-nodes"></i>
                    <span>Partager</span>
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
    // Bouton favoris
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
            // Mettre à jour le bouton sans recharger toute la fiche
            const isFav = isActivityFavorite(activity.id);
            favoriteBtn.classList.toggle('active', isFav);
            favoriteBtn.querySelector('i').className = `${isFav ? 'fa-solid' : 'fa-regular'} fa-heart`;
            const label = favoriteBtn.querySelector('span');
            if (label) label.textContent = isFav ? 'Favori' : 'Ajouter';
        });
    }
    
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
}

/**
 * Ajoute ou retire une activité des favoris
 * @param {number} activityId - ID de l'activité
 */
/**
 * Ajoute ou retire une activité des favoris
 * @param {number} activityId - ID de l'activité
 */
function toggleFavorite(activityId, activityData = null) {
    const favorites = getFavorites();
    const existingIndex = favorites.findIndex(f => f.id === activityId);
    
    if (existingIndex > -1) {
        favorites.splice(existingIndex, 1);
        showToast('Retiré des favoris', 'info');
    } else {
        // Priorité : données passées directement, sinon chercher dans le pool
        const poolEntry = activityPool.get(activityId);
        const source = activityData || (poolEntry ? poolEntry.activity : null);
        if (source) {
            favorites.push({
                id: source.id,
                name: source.name || source.title,
                lat: source.lat,
                lng: source.lng,
                type: source.type || source.category
            });
            showToast('Ajouté aux favoris !', 'success');
        } else {
            console.warn(`⚠️ Impossible d'ajouter le favori #${activityId} : données introuvables`);
            return;
        }
    }
    
    localStorage.setItem('favorites', JSON.stringify(favorites));
    updateFavoritesCount();
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
    showToast('Bientôt disponible — restez connectés !', 'info');
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
            showToast('Lien copié dans le presse-papier !', 'success');
        } catch {
            // Fallback si clipboard indisponible
            showToast(`Lien : ${url}`, 'info');
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
        showToast('Activité introuvable ou inaccessible', 'info');
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

    // Centrer la carte avec offset pour que le popup soit visible
    const zoom = Math.max(map.getZoom(), 15);
    const markerPoint = map.project([details.lat, details.lng], zoom);
    const offsetLatLng = map.unproject(markerPoint.subtract([0, 150]), zoom);
    map.setView(offsetLatLng, zoom);

    await loadAndShowActivityDetails(activityId, marker);
}

/**
 * Récupère les favoris depuis localStorage
 * @returns {Array<Object>} Liste des favoris avec {id, name, lat, lng, type}
 */
function getFavorites() {
    const favoritesStr = localStorage.getItem('favorites');
    return favoritesStr ? JSON.parse(favoritesStr) : [];
}

/**
 * Vérifie si une activité est dans les favoris
 * @param {number} activityId - ID de l'activité
 * @returns {boolean} true si l'activité est favorite
 */
function isActivityFavorite(activityId) {
    return getFavorites().some(f => f.id === activityId);
}

/**
 * Met à jour le compteur de favoris dans le header
 */
function updateFavoritesCount() {
    const favorites = getFavorites();
    const countElement = document.getElementById('favCount');
    if (countElement) {
        countElement.textContent = favorites.length;
    }
}

/**
 * Affiche la sidebar des favoris
 */
async function showFavoritesSidebar() {
    const sidebar = document.getElementById('favoritesSidebar');
    const content = document.getElementById('favoritesContent');
    
    const favorites = getFavorites();
    
    if (favorites.length === 0) {
        content.innerHTML = '<p class="fav-empty">Aucun favori pour le moment</p>';
    } else {
        content.innerHTML = favorites.map(fav => `
            <div class="fav-item" data-lat="${fav.lat}" data-lng="${fav.lng}" data-id="${fav.id}">
                <div class="fav-item-header">
                    <h3 class="fav-item-name">${fav.name}</h3>
                    <button class="remove-favorite" data-id="${fav.id}">
                        <i class="fas fa-heart"></i>
                    </button>
                </div>
                <span class="category-badge category-${fav.type.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-')}">${fav.type}</span>
            </div>
        `).join('');
        
        // Événements pour centrer la carte
        content.querySelectorAll('[data-lat]').forEach(element => {
            element.addEventListener('click', async (e) => {
                if (e.target.closest('.remove-favorite')) return;
                
                const lat = parseFloat(element.dataset.lat);
                const lng = parseFloat(element.dataset.lng);
                const id = parseInt(element.dataset.id);
                
                hideFavoritesSidebar();
                
                // Centrer la carte en décalant vers le bas pour que le popup soit centré
                const zoom = Math.max(map.getZoom(), 15);
                // Le popup s'affiche ~150px au-dessus du marker → on décale le centre vers le nord
                const markerPoint = map.project([lat, lng], zoom);
                const offsetLatLng = map.unproject(markerPoint.subtract([0, 150]), zoom);
                map.setView(offsetLatLng, zoom);
                
                // Chercher le marker dans le pool
                let poolEntry = activityPool.get(id);
                let marker;

                if (poolEntry) {
                    marker = poolEntry.marker;
                } else {
                    // Pas encore dans le pool → créer un marker temporaire directement sur la carte
                    console.log(`📍 Marker #${id} absent du pool, création d'un marker temporaire`);
                    const fav = getFavorites().find(f => f.id === id);
                    const activity = { id, lat, lng, category: fav ? fav.type : 'autre' };
                    marker = createMarker(activity, false);
                    activityPool.set(id, { activity, marker });
                }
                
                await loadAndShowActivityDetails(id, marker);
            });
        });
        
        // Événements pour retirer des favoris
        content.querySelectorAll('.remove-favorite').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseInt(btn.dataset.id);
                toggleFavorite(id);
                showFavoritesSidebar(); // Rafraîchir la sidebar
            });
        });
    }
    
    sidebar.dataset.open = 'true';
    sidebar.style.transform = 'translateX(0)';
}

/**
 * Cache la sidebar des favoris
 */
function hideFavoritesSidebar() {
    const sidebar = document.getElementById('favoritesSidebar');
    sidebar.dataset.open = 'false';
    sidebar.style.transform = 'translateX(400px)';
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

    toast.style.transform = 'translateY(0)';

    setTimeout(() => {
        toast.style.transform = 'translateY(200px)';
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
        showToast(`Aucune activité trouvée pour "${term}"`, 'info');
    } else {
        showToast(`${results.length} activité(s) trouvée(s)`, 'success');
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
        const offsetLatLng = map.unproject(markerPoint.subtract([0, 150]), zoom);
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
 * Initialisation de l'application au chargement de la page
 */
document.addEventListener('DOMContentLoaded', () => {
    checkStorageVersion();
    initMap();
    initStylePicker();
    handleDeepLink();
    
    // Timestamp pour éviter la fermeture immédiate sur mobile (stopPropagation peu fiable sur iOS)
    let sidebarOpenedAt = 0;

    // Configuration des événements
    const favoritesBtn = document.getElementById('favoritesBtn');
    if (favoritesBtn) {
        favoritesBtn.addEventListener('click', () => {
            showFavoritesSidebar();
            sidebarOpenedAt = Date.now();
        });
    }
    
    const closeSidebar = document.getElementById('closeSidebar');
    if (closeSidebar) {
        closeSidebar.addEventListener('click', () => hideFavoritesSidebar());
    }

    // Empêcher les clics à l'intérieur de la sidebar de la fermer
    const sidebar = document.getElementById('favoritesSidebar');
    if (sidebar) {
        sidebar.addEventListener('click', (e) => e.stopPropagation());
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
    
    // Fermer la sidebar en cliquant/touchant en dehors
    // Le délai de 50ms protège contre l'ouverture+fermeture immédiate sur mobile
    document.addEventListener('click', (e) => {
        if (Date.now() - sidebarOpenedAt < 50) return;
        const sidebarEl = document.getElementById('favoritesSidebar');
        const isOpen = sidebarEl.dataset.open === 'true';
        if (isOpen) hideFavoritesSidebar();
    });

    // ── Raccourcis clavier ────────────────────────────────────────────
    // Ne pas déclencher si l'utilisateur est dans un champ de saisie
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

        // Échap → fermer popup ou sidebar (dans cet ordre de priorité)
        if (e.key === 'Escape') {
            // Fermer un popup Leaflet ouvert
            if (map) {
                map.closePopup();
            }
            // Fermer la sidebar si ouverte
            const sidebarEl = document.getElementById('favoritesSidebar');
            if (sidebarEl?.dataset.open === 'true') {
                hideFavoritesSidebar();
            }
            // Vider la recherche si active
            if (isSearchMode && searchInput) {
                searchInput.value = '';
                exitSearchMode();
            }
            return;
        }

        // F → ouvrir / fermer la sidebar des favoris
        if ((e.key === 'f' || e.key === 'F') && !isTyping) {
            const sidebarEl = document.getElementById('favoritesSidebar');
            if (sidebarEl?.dataset.open === 'true') {
                hideFavoritesSidebar();
            } else {
                showFavoritesSidebar();
                sidebarOpenedAt = Date.now();
            }
            return;
        }
    });
});
