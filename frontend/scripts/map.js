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
        localStorage.setItem('storage_version', STORAGE_VERSION);
    }
}

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
let activities = []; // Activités légères (dans le rayon)
let markers = [];
let userMarker;
let userCircle;
let resizeHandle; // Nouvelle variable pour le handle de redimensionnement
let userPosition = MAP_CONFIG.center;
let currentRadius = MAP_CONFIG.defaultRadiusMeters; // Rayon actuel
let circleEnabled = true; // Le cercle est activé par défaut
let isResizingCircle = false; // Mode redimensionnement
let radiusTooltip; // Infobulle pour afficher la distance

/**
 * Initialise la carte Leaflet
 */
function initMap() {
    // Création de la carte centrée sur Paris
    map = L.map('map', {
        zoomControl: false,
        attributionControl: false
    }).setView(MAP_CONFIG.center, MAP_CONFIG.zoom);
    
    // Utilisation du style Carto Light
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        minZoom: MAP_CONFIG.minZoom,
        maxZoom: MAP_CONFIG.maxZoom,
        subdomains: 'abcd'
    }).addTo(map);
    
    // Création du marqueur utilisateur et du cercle
    createUserMarker();
    
    // Création de l'infobulle pour le rayon
    createRadiusTooltip();
    
    // Chargement des activités dans le rayon
    loadActivitiesInRadius();
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
    
    // Création du marqueur utilisateur draggable
    const userIcon = L.divIcon({
        html: '<div class="user-marker"></div>',
        className: 'user-marker-container',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });
    
    userMarker = L.marker(userPosition, {
        icon: userIcon,
        draggable: true,
        zIndexOffset: 2000
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
    
    // Événement de fin de déplacement
    userMarker.on('dragend', function(e) {
        const newPos = e.target.getLatLng();
        userPosition = [newPos.lat, newPos.lng];
        
        // Recharger les activités dans le nouveau rayon
        loadActivitiesInRadius();
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
        
        // Recharger les activités avec le nouveau rayon
        loadActivitiesInRadius();
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
    
    // Recharger les activités
    loadActivitiesInRadius();
}

/**
 * Charge les activités dans le rayon actuel
 */
async function loadActivitiesInRadius() {
    try {
        // Appel API avec ou sans rayon selon circleEnabled
        const radius = circleEnabled ? currentRadius : null;
        activities = await getActivitiesInRadius(userPosition[0], userPosition[1], radius);
        
        // Afficher les activités sur la carte
        displayActivities(activities);
        
        // Mettre à jour le compteur de favoris
        updateFavoritesCount();
        
        console.log(`${activities.length} activité(s) chargée(s) ${circleEnabled ? 'dans le rayon' : 'sans limite'}`);
    } catch (error) {
        console.error('Erreur lors du chargement des activités:', error);
        showToast('Erreur lors du chargement des activités', 'error');
    }
}

/**
 * Affiche les activités sur la carte
 * @param {Array} activitiesToDisplay - Liste des activités à afficher
 */
function displayActivities(activitiesToDisplay) {
    // Suppression des markers existants
    markers.forEach(marker => map.removeLayer(marker));
    markers = [];
    
    // Création des markers pour chaque activité
    activitiesToDisplay.forEach(activity => {
        const marker = createMarker(activity);
        markers.push(marker);
    });
}

/**
 * Crée un marker pour une activité (version légère)
 * @param {Object} activity - Données de l'activité (version légère)
 * @returns {L.Marker} Le marker créé
 */
function createMarker(activity) {
    // Icône personnalisée selon la catégorie
    const iconConfig = getIconConfig(activity.category);
    
    const customIcon = L.divIcon({
        html: `<div class="flex items-center justify-center w-10 h-10 bg-${iconConfig.color}-500 rounded-full shadow-lg text-white text-xl border-4 border-white">
                <i class="fas fa-${iconConfig.icon}"></i>
               </div>`,
        className: 'custom-marker',
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        popupAnchor: [0, -20]
    });
    
    // Création du marker
    const marker = L.marker([activity.lat, activity.lng], {
        icon: customIcon
    }).addTo(map);
    
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
                .setContent('<div class="p-4 text-center"><i class="fas fa-spinner fa-spin text-2xl text-blue-500"></i><p class="mt-2">Chargement...</p></div>');
            marker.bindPopup(loadingPopup);
        } else {
            console.log('♻️ Réutilisation popup existant');
            marker.setPopupContent('<div class="p-4 text-center"><i class="fas fa-spinner fa-spin text-2xl text-blue-500"></i><p class="mt-2">Chargement...</p></div>');
        }
        
        // IMPORTANT: Toujours ouvrir le popup
        marker.openPopup();
        console.log('👁️ Popup ouvert');
        
        // Charger les détails depuis l'API
        const details = await getActivityDetails(activityId);
        
        if (!details) {
            console.error(`❌ Impossible de charger #${activityId}`);
            marker.setPopupContent('<div class="p-4 text-center text-red-500">Erreur lors du chargement</div>');
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
        
    } catch (error) {
        console.error(`❌ Erreur popup #${activityId}:`, error);
        if (marker.getPopup()) {
            marker.setPopupContent('<div class="p-4 text-center text-red-500">Erreur lors du chargement</div>');
        }
    }
}

/**
 * Retourne la configuration d'icône selon la catégorie
 * @param {string} category - Catégorie de l'activité
 * @returns {Object} Configuration de l'icône
 */
function getIconConfig(category) {
    const configs = {
        // Culture
        'musée': { icon: 'landmark', color: 'blue' },
        'cinéma': { icon: 'film', color: 'indigo' },
        'théâtre': { icon: 'masks-theater', color: 'purple' },
        'galerie': { icon: 'palette', color: 'pink' },
        'bibliothèque': { icon: 'book', color: 'blue' },
        
        // Nature & Loisirs
        'parc': { icon: 'tree', color: 'green' },
        'jardin': { icon: 'leaf', color: 'green' },
        'zoo': { icon: 'paw', color: 'green' },
        
        // Sport
        'karting': { icon: 'flag-checkered', color: 'orange' },
        'golf': { icon: 'golf-ball-tee', color: 'green' },
        'piscine': { icon: 'person-swimming', color: 'blue' },
        'centre sportif': { icon: 'dumbbell', color: 'red' },
        'stade': { icon: 'futbol', color: 'orange' },
        
        // Vie nocturne & Restaurants
        'vie nocturne': { icon: 'music', color: 'purple' },
        'nightclub': { icon: 'music', color: 'purple' },
        'restaurant': { icon: 'utensils', color: 'orange' },
        'café': { icon: 'mug-hot', color: 'brown' },
        'bar': { icon: 'martini-glass', color: 'purple' },
        
        // Autres
        'attraction': { icon: 'star', color: 'yellow' },
        'autre': { icon: 'map-marker-alt', color: 'gray' }
    };
    return configs[category?.toLowerCase()] || { icon: 'map-marker-alt', color: 'blue' };
}

/**
 * Crée le contenu HTML du popup
 * @param {Object} activity - Données complètes de l'activité
 * @returns {string} HTML du popup
 */
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
    
    return `
        <div class="popup-content">
            <div class="popup-header">
                <h3 class="text-xl font-bold mb-1">${activity.title}</h3>
                <span class="category-badge category-${categoryClass}">${activity.category || 'Autre'}</span>
            </div>
            
            <div class="popup-body">
                ${activity.address || activity.description ? `
                    <div class="mb-3">
                        ${activity.address ? `
                            <p class="text-gray-600 text-sm mb-2">
                                <i class="fas fa-map-marker-alt text-blue-600 mr-2"></i>${activity.address}
                            </p>
                        ` : ''}
                        ${activity.description ? `
                            <p class="text-gray-700 text-sm">${activity.description}</p>
                        ` : ''}
                    </div>
                ` : ''}
                
                ${activity.website || activity.phone ? `
                    <div class="space-y-2 text-sm">
                        ${activity.website ? `
                            <a href="${activity.website}" target="_blank" class="text-blue-600 hover:text-blue-800 flex items-center gap-2">
                                <i class="fas fa-globe"></i>
                                <span class="underline">Visiter le site web</span>
                            </a>
                        ` : ''}
                        
                        ${activity.phone ? `
                            <a href="tel:${activity.phone}" class="text-blue-600 hover:text-blue-800 flex items-center gap-2">
                                <i class="fas fa-phone"></i>
                                <span>${activity.phone}</span>
                            </a>
                        ` : ''}
                    </div>
                ` : ''}
            </div>
            
            <div class="popup-footer">
                <button class="popup-btn btn-favorite ${favoriteClass}" data-action="favorite" data-id="${activity.id}">
                    <i class="${favoriteIcon} fa-heart"></i>
                    <span class="hidden sm:inline">${isFavorite ? 'Favori' : 'Ajouter'}</span>
                </button>
                
                <button class="popup-btn btn-itinerary" data-action="itinerary" data-id="${activity.id}">
                    <i class="fas fa-route"></i>
                    <span class="hidden sm:inline">Itinéraire</span>
                </button>
                
                <button class="popup-btn btn-similar" data-action="similar" data-id="${activity.id}">
                    <i class="fas fa-search"></i>
                    <span class="hidden sm:inline">Similaires</span>
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
        // Priorité : données passées directement, sinon chercher dans activities[]
        const source = activityData || activities.find(a => a.id === activityId);
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
    showToast('Fonctionnalité en développement', 'info');
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
        content.innerHTML = '<p class="text-gray-500 text-center py-8">Aucun favori pour le moment</p>';
    } else {
        content.innerHTML = favorites.map(fav => `
            <div class="mb-4 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition cursor-pointer" data-lat="${fav.lat}" data-lng="${fav.lng}" data-id="${fav.id}">
                <div class="flex justify-between items-start mb-2">
                    <h3 class="font-bold text-gray-800">${fav.name}</h3>
                    <button class="text-red-500 hover:text-red-700 remove-favorite" data-id="${fav.id}">
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
                
                // Chercher le marker dans ceux affichés
                let marker = markers.find(m => 
                    Math.abs(m.getLatLng().lat - lat) < 0.0001 && 
                    Math.abs(m.getLatLng().lng - lng) < 0.0001
                );
                
                if (!marker) {
                    // Marker non visible (hors rayon ou filtre) → créer un marker temporaire
                    console.log(`📍 Marker #${id} absent de la carte, création d'un marker temporaire`);
                    const fav = getFavorites().find(f => f.id === id);
                    marker = createMarker({
                        id: id,
                        lat: lat,
                        lng: lng,
                        category: fav ? fav.type : 'autre'
                    });
                    // Ajouter au tableau markers pour qu'il persiste sur la carte
                    markers.push(marker);
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
    
    const colors = {
        success: 'bg-green-500',
        error: 'bg-red-500',
        info: 'bg-blue-500'
    };
    
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        info: 'fa-info-circle'
    };
    
    toast.className = `fixed bottom-8 right-8 z-[1001] ${colors[type]} text-white px-6 py-3 rounded-lg shadow-lg transform transition-transform duration-300`;
    toastMessage.innerHTML = `<i class="fas ${icons[type]} mr-2"></i>${message}`;
    
    toast.style.transform = 'translateY(0)';
    
    setTimeout(() => {
        toast.style.transform = 'translateY(200px)';
    }, 3000);
}

/**
 * Filtre les activités selon le terme de recherche
 * @param {string} searchTerm - Terme de recherche
 */
async function searchActivities(searchTerm) {
    if (!searchTerm || searchTerm.trim() === '') {
        // Recherche vide : recharger les activités normales
        await loadActivitiesInRadius();
        return;
    }
    
    const term = searchTerm.trim();
    let results = [];
    
    if (circleEnabled) {
        // Avec rayon actif : filtrage côté client sur les activités déjà chargées
        results = activities.filter(activity => {
            const title = activity.title.toLowerCase();
            const category = activity.category.toLowerCase();
            return title.includes(term.toLowerCase()) || category.includes(term.toLowerCase());
        });
    } else {
        // Sans rayon : recherche dans toute la base côté serveur
        console.log(`🔍 Recherche globale côté serveur pour "${term}"`);
        const userPos = userMarker.getLatLng();
        results = await searchActivitiesGlobal(term, userPos.lat, userPos.lng);
    }
    
    displayActivities(results);
    
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
        
        const marker = markers.find(m =>
            Math.abs(m.getLatLng().lat - activity.lat) < 0.0001 &&
            Math.abs(m.getLatLng().lng - activity.lng) < 0.0001
        );
        if (marker) {
            await loadAndShowActivityDetails(activity.id, marker);
        }
    } else {
        // Construire les bounds pour englober tous les résultats
        const bounds = L.latLngBounds(results.map(a => [a.lat, a.lng]));
        map.fitBounds(bounds, {
            padding: [60, 60],  // Marge autour des markers
            maxZoom: 14         // Ne pas zoomer trop près si les points sont proches
        });
    }
}

/**
 * Initialisation de l'application au chargement de la page
 */
document.addEventListener('DOMContentLoaded', () => {
    checkStorageVersion();
    initMap();
    
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
});
