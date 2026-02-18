/**
 * Module API - Gestion des appels API
 * 
 * Optimisé pour charger uniquement les données nécessaires :
 * - Liste d'activités : données minimales (id, name, lat, lng, type)
 * - Détails d'activité : toutes les données (chargement différé au clic)
 */

// Configuration de l'URL de l'API selon l'environnement
function getApiBaseUrl() {
    // Si on est en développement local (localhost ou 127.0.0.1)
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return 'http://localhost:3000/api';
    }
    
    // En production, utiliser l'URL relative (même domaine) ou construire l'URL
    // Option 1 : URL relative (si frontend et backend sur même domaine/port)
    // return '/api';
    
    // Option 2 : Utiliser le hostname actuel avec le port du backend
    return `${window.location.protocol}//${window.location.hostname}:3000/api`;
    
    // Option 3 : URL absolue si backend sur domaine/port différent
    // return 'https://votre-domaine.com/api';
}

const API_BASE_URL = getApiBaseUrl();
console.log('🌐 API URL:', API_BASE_URL);

/**
 * Calcule la distance entre deux points géographiques (formule de Haversine)
 * @param {number} lat1 - Latitude du point 1
 * @param {number} lng1 - Longitude du point 1
 * @param {number} lat2 - Latitude du point 2
 * @param {number} lng2 - Longitude du point 2
 * @returns {number} Distance en mètres
 */
function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371e3; // Rayon de la Terre en mètres
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance en mètres
}

/**
 * Récupère les activités (version légère) dans un rayon donné
 * @param {number} centerLat - Latitude du centre
 * @param {number} centerLng - Longitude du centre
 * @param {number} radiusMeters - Rayon en mètres (null = pas de limite)
 * @returns {Promise<Array>} Liste des activités légères
 */
async function getActivitiesInRadius(centerLat, centerLng, radiusMeters = null) {
    try {
        // Construire l'URL avec les paramètres
        let url = `${API_BASE_URL}/activities`;
        const params = new URLSearchParams();
        
        if (centerLat && centerLng) {
            params.append('lat', centerLat);
            params.append('lng', centerLng);
        }
        
        if (radiusMeters !== null) {
            params.append('radius', radiusMeters);
        }
        
        if (params.toString()) {
            url += `?${params.toString()}`;
        }
        
        console.log('🔍 API: Chargement activités', { url, radius: radiusMeters });
        
        // Appel API
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        const activities = result.data || result;
        
        console.log(`✅ API: ${activities.length} activités reçues`);
        
        // Convertir le format de l'API vers le format attendu par le frontend
        return activities.map(activity => ({
            id: activity.id,
            title: activity.name,
            lat: activity.latitude,
            lng: activity.longitude,
            category: activity.type
        }));
        
    } catch (error) {
        console.error('❌ API: Erreur chargement activités', error);
        // En cas d'erreur, retourner un tableau vide
        return [];
    }
}

/**
 * Récupère les détails complets d'une activité (chargement différé)
 * @param {number} activityId - ID de l'activité
 * @returns {Promise<Object|null>} Détails de l'activité
 */
async function getActivityDetails(activityId) {
    try {
        console.log(`🔍 API: Chargement détails activité #${activityId}`);
        
        // Appel API pour récupérer les détails
        const response = await fetch(`${API_BASE_URL}/activities/${activityId}`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        const activity = result.data || result;
        
        console.log(`✅ API: Détails activité #${activityId} reçus`);
        
        // Convertir le format de l'API vers le format attendu par le frontend
        return {
            id: activity.id,
            title: activity.name,
            address: activity.address || 'Adresse non disponible',
            lat: activity.latitude,
            lng: activity.longitude,
            website: activity.website,
            phone: activity.phone,
            description: activity.description || 'Description non disponible',
            category: activity.type,
            openingHours: activity.openingHours
        };
        
    } catch (error) {
        console.error(`❌ API: Erreur chargement détails #${activityId}`, error);
        return null;
    }
}

/**
 * Ajoute une activité aux favoris (localStorage uniquement)
 * @param {number} activityId - ID de l'activité
 * @returns {Promise<Object>} Résultat de l'opération
 */
async function addToFavoritesAPI(activityId) {
    // Fonction conservée pour compatibilité mais ne fait rien
    // Les favoris sont gérés uniquement dans localStorage
    return { success: true, message: "Favori géré localement" };
}

/**
 * Récupère une activité légère par son ID (DEPRECATED - ne plus utiliser)
 * @param {number} activityId - ID de l'activité
 * @returns {Object|null} L'activité trouvée ou null
 */
function getActivityLightById(activityId) {
    // Chercher dans les activités chargées actuellement
    return activities.find(a => a.id === activityId) || null;
}
