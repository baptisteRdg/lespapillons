/**
 * Helpers pour la conversion GeoJSON ↔ Base de données
 */

/**
 * Convertit un Feature GeoJSON en objet pour la base de données
 * 
 * @param {Object} feature - Feature GeoJSON
 * @returns {Object} Données formatées pour Prisma
 * 
 * Exemple de GeoJSON Feature:
 * {
 *   "type": "Feature",
 *   "geometry": {
 *     "type": "Point",
 *     "coordinates": [2.3376, 48.8606]  // [longitude, latitude]
 *   },
 *   "properties": {
 *     "name": "Musée du Louvre",
 *     "type": "musée",
 *     "address": "Rue de Rivoli, 75001 Paris",
 *     "rating": 4.5,
 *     "custom_field": "valeur quelconque",
 *     // ... n'importe quelle autre propriété
 *   }
 * }
 */
function geojsonToActivity(feature) {
    // Vérifier que c'est bien un Feature avec geometry
    if (feature.type !== 'Feature' || !feature.geometry) {
        throw new Error('Format GeoJSON invalide : doit être un Feature avec geometry');
    }
    
    // Vérifier que c'est un Point
    if (feature.geometry.type !== 'Point') {
        throw new Error('Seuls les Points sont supportés pour le moment');
    }
    
    const coords = feature.geometry.coordinates;
    const props = feature.properties || {};
    
    // Extraire les champs obligatoires
    const name = props.name || props.nom;
    const type = props.type || props.category || props.categorie;
    const longitude = coords[0]; // GeoJSON : [lng, lat]
    const latitude = coords[1];
    
    // Validation des champs obligatoires
    if (!name) {
        throw new Error('Le champ "name" est obligatoire dans properties');
    }
    if (!type) {
        throw new Error('Le champ "type" est obligatoire dans properties');
    }
    if (typeof longitude !== 'number' || typeof latitude !== 'number') {
        throw new Error('Coordonnées invalides dans geometry.coordinates');
    }
    
    // Extraire les champs connus (bonus)
    const address = props.address || props.adresse || null;
    const phone = props.phone || props.telephone || props.tel || null;
    const website = props.website || props.site || props.url || null;
    const description = props.description || props.desc || null;
    const openingHours = props.opening_hours || props.openingHours || props.horaires || null;
    
    // Préparer les propriétés flexibles (tout le reste)
    const knownFields = ['name', 'nom', 'type', 'category', 'categorie', 
                        'address', 'adresse', 'phone', 'telephone', 'tel',
                        'website', 'site', 'url', 'description', 'desc',
                        'opening_hours', 'openingHours', 'horaires'];
    
    const flexibleProps = {};
    for (const [key, value] of Object.entries(props)) {
        if (!knownFields.includes(key)) {
            flexibleProps[key] = value;
        }
    }
    
    // Retourner l'objet formaté pour Prisma
    // Sérialiser les properties en JSON string (SQLite ne supporte pas Json)
    return {
        name,
        type,
        latitude,
        longitude,
        address,
        phone,
        website,
        description,
        openingHours,
        properties: Object.keys(flexibleProps).length > 0 ? JSON.stringify(flexibleProps) : null
    };
}

/**
 * Convertit une activité de la BD en Feature GeoJSON
 * 
 * @param {Object} activity - Activité depuis Prisma
 * @returns {Object} Feature GeoJSON
 */
function activityToGeojson(activity) {
    // Désérialiser les properties si elles existent (stockées en JSON string)
    let flexibleProps = {};
    if (activity.properties) {
        try {
            flexibleProps = JSON.parse(activity.properties);
        } catch (e) {
            console.error('Erreur parsing properties:', e);
        }
    }
    
    // Construire les properties en fusionnant les champs connus et flexibles
    const properties = {
        id: activity.id,
        name: activity.name,
        type: activity.type,
        ...(activity.address && { address: activity.address }),
        ...(activity.phone && { phone: activity.phone }),
        ...(activity.website && { website: activity.website }),
        ...(activity.description && { description: activity.description }),
        ...(activity.openingHours && { openingHours: activity.openingHours }),
        // Ajouter toutes les propriétés flexibles
        ...flexibleProps
    };
    
    // Retourner le Feature GeoJSON
    return {
        type: 'Feature',
        geometry: {
            type: 'Point',
            coordinates: [activity.longitude, activity.latitude] // GeoJSON : [lng, lat]
        },
        properties
    };
}

/**
 * Convertit un FeatureCollection GeoJSON en tableau d'activités
 * 
 * @param {Object} featureCollection - FeatureCollection GeoJSON
 * @returns {Array} Tableau d'objets pour Prisma
 * 
 * Exemple:
 * {
 *   "type": "FeatureCollection",
 *   "features": [
 *     { "type": "Feature", "geometry": {...}, "properties": {...} },
 *     { "type": "Feature", "geometry": {...}, "properties": {...} }
 *   ]
 * }
 */
function geojsonCollectionToActivities(featureCollection) {
    if (featureCollection.type !== 'FeatureCollection') {
        throw new Error('Format invalide : doit être un FeatureCollection');
    }
    
    if (!Array.isArray(featureCollection.features)) {
        throw new Error('Le FeatureCollection doit contenir un tableau "features"');
    }
    
    const activities = [];
    const errors = [];
    
    featureCollection.features.forEach((feature, index) => {
        try {
            activities.push(geojsonToActivity(feature));
        } catch (error) {
            errors.push({ index, error: error.message });
        }
    });
    
    return {
        success: activities,
        errors: errors.length > 0 ? errors : null,
        summary: {
            total: featureCollection.features.length,
            converted: activities.length,
            failed: errors.length
        }
    };
}

/**
 * Convertit un tableau d'activités en FeatureCollection GeoJSON
 * 
 * @param {Array} activities - Tableau d'activités depuis Prisma
 * @returns {Object} FeatureCollection GeoJSON
 */
function activitiesToGeojsonCollection(activities) {
    return {
        type: 'FeatureCollection',
        features: activities.map(activity => activityToGeojson(activity))
    };
}

module.exports = {
    geojsonToActivity,
    activityToGeojson,
    geojsonCollectionToActivities,
    activitiesToGeojsonCollection
};
