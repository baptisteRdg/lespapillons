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
    // En production derrière le reverse proxy : même domaine, chemin /api
    return '/api';
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
        
        // Extraire wikidata et image depuis le champ properties (JSON sérialisé)
        let wikidata = null;
        let image = null;
        if (activity.properties) {
            try {
                const props = JSON.parse(activity.properties);
                wikidata = props.wikidata || null;
                image = props.image || null;
            } catch {}
        }

        // Convertir le format de l'API vers le format attendu par le frontend
        return {
            id: activity.id,
            title: activity.name,
            address: activity.address || null,
            lat: activity.latitude,
            lng: activity.longitude,
            website: activity.website,
            phone: activity.phone,
            description: activity.description || null,
            category: activity.type,
            openingHours: activity.openingHours,
            wikidata,
            image
        };
        
    } catch (error) {
        console.error(`❌ API: Erreur chargement détails #${activityId}`, error);
        return null;
    }
}

/**
 * Recherche des activités dans toute la base (sans limite de 100)
 * Utilisé quand le rayon de recherche est désactivé
 * @param {string} searchTerm - Terme de recherche
 * @param {number} centerLat - Latitude du centre (pour tri par proximité)
 * @param {number} centerLng - Longitude du centre
 * @returns {Promise<Array>} Liste des activités correspondantes
 */
async function searchActivitiesGlobal(searchTerm, centerLat, centerLng) {
    try {
        const params = new URLSearchParams({ search: searchTerm });
        if (centerLat && centerLng) {
            params.append('lat', centerLat);
            params.append('lng', centerLng);
        }
        const url = `${API_BASE_URL}/activities?${params.toString()}`;
        console.log('🔍 API: Recherche globale', { url });

        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const result = await response.json();
        const data = result.data || result;
        console.log(`✅ API: ${data.length} résultat(s) pour "${searchTerm}"`);

        return data.map(activity => ({
            id: activity.id,
            title: activity.name,
            lat: activity.latitude,
            lng: activity.longitude,
            category: activity.type
        }));
    } catch (error) {
        console.error('❌ API: Erreur recherche globale', error);
        return [];
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

// Cache mémoire pour les données Wikidata et og:image (durée de la session)
const _wikidataCache = new Map();
const _ogImageCache  = new Map();

/**
 * Récupère l'og:image (ou twitter:image) d'un site web via le proxy backend
 * @param {string} websiteUrl - URL du site de l'activité
 * @returns {Promise<string|null>} URL de l'image ou null
 */
async function getOgImage(websiteUrl) {
    if (_ogImageCache.has(websiteUrl)) {
        console.log(`⚡ og-image: cache hit pour ${websiteUrl}`);
        return _ogImageCache.get(websiteUrl);
    }
    console.log(`🌐 og-image: requête pour ${websiteUrl}`);
    try {
        const proxyUrl = `${API_BASE_URL}/og-image?url=${encodeURIComponent(websiteUrl)}`;
        const response = await fetch(proxyUrl);
        if (!response.ok) return null;
        const data = await response.json();
        const imageUrl = data.imageUrl || null;
        if (imageUrl) {
            console.log(`✅ og-image trouvée: ${imageUrl}`);
        } else {
            console.log(`ℹ️ Pas d'og:image pour ${websiteUrl}`);
        }
        _ogImageCache.set(websiteUrl, imageUrl);
        return imageUrl;
    } catch (err) {
        console.error(`❌ og-image erreur pour ${websiteUrl}`, err);
        return null;
    }
}

/**
 * Récupère en un seul appel toutes les données Wikidata utiles pour enrichir une fiche :
 * image (P18), description, site web (P856), téléphone (P1329), adresse (P6375/P969)
 * Les résultats sont mis en cache pour la durée de la session.
 * @param {string} wikidataId - Code Wikidata (ex: "Q12345")
 * @returns {Promise<{imageUrl, description, website, phone, address}>}
 */
async function getWikidataData(wikidataId) {
    // Validation stricte du format Wikidata (Q suivi de chiffres uniquement)
    if (!wikidataId || !/^Q\d+$/.test(wikidataId)) {
        console.warn(`⚠️ Wikidata: ID invalide "${wikidataId}", requête annulée`);
        return {};
    }
    if (_wikidataCache.has(wikidataId)) {
        console.log(`⚡ Wikidata: cache hit pour ${wikidataId}`);
        return _wikidataCache.get(wikidataId);
    }
    console.log(`🌐 Wikidata: requête données pour ${wikidataId}`);
    try {
        const apiUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(wikidataId)}&props=claims%7Cdescriptions&languages=fr%7Cen&format=json&origin=*`;
        const response = await fetch(apiUrl);
        if (!response.ok) {
            console.warn(`⚠️ Wikidata: HTTP ${response.status} pour ${wikidataId}`);
            return {};
        }
        const data = await response.json();
        const entity = data.entities?.[wikidataId];
        if (!entity) return {};

        // Image : P18
        let imageUrl = null;
        const imageClaims = entity.claims?.P18;
        if (imageClaims?.length) {
            const imageName = imageClaims[0]?.mainsnak?.datavalue?.value;
            if (imageName) {
                const encoded = encodeURIComponent(imageName.replace(/ /g, '_'));
                imageUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encoded}?width=500`;
            }
        }

        // Description : champ natif Wikidata (fr en priorité, puis en)
        const description = entity.descriptions?.fr?.value
            || entity.descriptions?.en?.value
            || null;

        // Site web : P856
        let website = null;
        const webClaims = entity.claims?.P856;
        if (webClaims?.length) {
            website = webClaims[0]?.mainsnak?.datavalue?.value || null;
        }

        // Téléphone : P1329
        let phone = null;
        const phoneClaims = entity.claims?.P1329;
        if (phoneClaims?.length) {
            phone = phoneClaims[0]?.mainsnak?.datavalue?.value || null;
        }

        // Adresse : P6375 (monolingual text) ou P969 (string)
        let address = null;
        const addrClaims = entity.claims?.P6375 || entity.claims?.P969;
        if (addrClaims?.length) {
            const val = addrClaims[0]?.mainsnak?.datavalue?.value;
            address = typeof val === 'string' ? val : (val?.text || null);
        }

        console.log(`✅ Wikidata données pour ${wikidataId}:`, {
            image: !!imageUrl, description: !!description,
            website: !!website, phone: !!phone, address: !!address
        });
        const result = { imageUrl, description, website, phone, address };
        _wikidataCache.set(wikidataId, result);
        return result;
    } catch (err) {
        console.error(`❌ Wikidata: erreur pour ${wikidataId}`, err);
        return {};
    }
}

/**
 * Récupère les activités dans le viewport visible de la carte
 * @param {L.LatLngBounds} bounds - Bounds Leaflet du viewport
 * @param {number} limitPerType - Nombre max d'activités par type
 * @returns {Promise<Array>} Liste d'activités légères
 */
async function getActivitiesByBbox(bounds, limitPerType) {
    try {
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        const bbox = `${sw.lat},${sw.lng},${ne.lat},${ne.lng}`;
        const params = new URLSearchParams({ bbox, limitPerType });
        const url = `${API_BASE_URL}/activities?${params}`;

        console.log(`🗺️ API: bbox viewport, limitPerType=${limitPerType}`);

        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        const data = result.data || result;

        console.log(`✅ API: ${data.length} activités dans le viewport`);

        return data.map(a => ({
            id: a.id,
            title: a.name,
            lat: a.latitude,
            lng: a.longitude,
            category: a.type
        }));
    } catch (error) {
        console.error('❌ API: Erreur chargement viewport', error);
        return [];
    }
}

