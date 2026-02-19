/**
 * Script d'Import des Fichiers GeoJSON
 * 
 * Lit tous les fichiers .geojson du dossier data/geojson/
 * et les importe dans la base de données
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

// Mapping des tags OSM vers nos catégories
const AMENITY_TO_TYPE_MAPPING = {
    'nightclub': 'vie nocturne',
    'restaurant': 'restaurant',
    'cafe': 'café',
    'bar': 'bar',
    'pub': 'pub',
    'cinema': 'cinéma',
    'theatre': 'théâtre',
    'museum': 'musée',
    'gallery': 'galerie',
    'library': 'bibliothèque',
    'arts_centre': 'centre culturel',
    'community_centre': 'centre communautaire',
    'social_facility': 'social',
    'place_of_worship': 'lieu de culte',
    'hospital': 'santé',
    'pharmacy': 'pharmacie',
    'doctors': 'médecin',
    'dentist': 'dentiste',
    'veterinary': 'vétérinaire',
    'school': 'école',
    'university': 'université',
    'college': 'collège',
    'kindergarten': 'maternelle',
    'parking': 'parking',
    'fuel': 'station-service',
    'charging_station': 'borne électrique',
    'bicycle_rental': 'location vélo',
    'car_rental': 'location voiture',
    'taxi': 'taxi',
    'bank': 'banque',
    'atm': 'distributeur',
    'post_office': 'poste',
    'police': 'police',
    'fire_station': 'pompiers',
    'townhall': 'mairie',
    'courthouse': 'tribunal'
};

const TOURISM_TO_TYPE_MAPPING = {
    'attraction': 'attraction',
    'museum': 'musée',
    'gallery': 'galerie',
    'artwork': 'art public',
    'viewpoint': 'point de vue',
    'zoo': 'zoo',
    'theme_park': 'parc d\'attractions',
    'hotel': 'hôtel',
    'hostel': 'auberge',
    'guest_house': 'maison d\'hôtes',
    'motel': 'motel',
    'apartment': 'appartement',
    'camp_site': 'camping',
    'caravan_site': 'camping-car',
    'information': 'information touristique',
    'picnic_site': 'aire de pique-nique'
};

const LEISURE_TO_TYPE_MAPPING = {
    'park': 'parc',
    'garden': 'jardin',
    'playground': 'aire de jeux',
    'sports_centre': 'centre sportif',
    'stadium': 'stade',
    'swimming_pool': 'piscine',
    'fitness_centre': 'salle de sport',
    'golf_course': 'golf',
    'pitch': 'terrain de sport',
    'track': 'piste',
    'water_park': 'parc aquatique',
    'marina': 'marina',
    'beach_resort': 'station balnéaire',
    'nature_reserve': 'réserve naturelle',
    'fishing': 'pêche',
    'horse_riding': 'équitation',
    'ice_rink': 'patinoire',
    'miniature_golf': 'mini-golf'
};

const SHOP_TO_TYPE_MAPPING = {
    'mall': 'centre commercial',
    'supermarket': 'supermarché',
    'bakery': 'boulangerie',
    'butcher': 'boucherie',
    'clothes': 'vêtements',
    'shoes': 'chaussures',
    'books': 'librairie',
    'toys': 'jouets',
    'sports': 'sport',
    'electronics': 'électronique',
    'furniture': 'meubles',
    'florist': 'fleuriste',
    'gift': 'cadeaux',
    'jewelry': 'bijouterie',
    'beauty': 'beauté',
    'hairdresser': 'coiffeur',
    'chemist': 'droguerie',
    'optician': 'opticien',
    'pet': 'animalerie'
};

/**
 * Extrait le type d'activité depuis les propriétés OSM
 */
function extractType(properties) {
    // Vérifier si 'type' existe déjà
    if (properties.type) {
        return properties.type;
    }
    
    // Vérifier amenity
    if (properties.amenity && AMENITY_TO_TYPE_MAPPING[properties.amenity]) {
        return AMENITY_TO_TYPE_MAPPING[properties.amenity];
    }
    
    // Vérifier tourism
    if (properties.tourism && TOURISM_TO_TYPE_MAPPING[properties.tourism]) {
        return TOURISM_TO_TYPE_MAPPING[properties.tourism];
    }
    
    // Vérifier leisure
    if (properties.leisure && LEISURE_TO_TYPE_MAPPING[properties.leisure]) {
        return LEISURE_TO_TYPE_MAPPING[properties.leisure];
    }
    
    // Vérifier shop
    if (properties.shop && SHOP_TO_TYPE_MAPPING[properties.shop]) {
        return SHOP_TO_TYPE_MAPPING[properties.shop];
    }
    
    // Par défaut, utiliser amenity/tourism/leisure/shop tel quel
    return properties.amenity || properties.tourism || properties.leisure || properties.shop || 'autre';
}

/**
 * Extrait l'adresse depuis les propriétés OSM
 */
function extractAddress(properties) {
    const parts = [];
    
    if (properties['addr:housenumber'] || properties['addr:street']) {
        if (properties['addr:housenumber']) parts.push(properties['addr:housenumber']);
        if (properties['addr:street']) parts.push(properties['addr:street']);
    }
    
    if (properties['addr:postcode'] || properties['addr:city']) {
        const cityParts = [];
        if (properties['addr:postcode']) cityParts.push(properties['addr:postcode']);
        if (properties['addr:city']) cityParts.push(properties['addr:city']);
        parts.push(cityParts.join(' '));
    }
    
    return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * Dérive le type d'activité depuis le nom du fichier (ex. laser-game.geojson → "laser game")
 * Utilisé pour que tout un fichier ait le même type et que tu puisses mapper les icônes par fichier.
 */
function typeFromFilename(filePath) {
    const base = path.basename(filePath, '.geojson');
    return base.replace(/[-_]/g, ' ').trim().toLowerCase();
}

/**
 * Convertit un Feature GeoJSON en données pour la base
 * @param {Object} feature - Feature GeoJSON
 * @param {string} [typeOverride] - Si fourni (ex. dérivé du nom du fichier), utilisé comme type au lieu des tags OSM
 */
function convertFeatureToActivity(feature, typeOverride) {
    const props = feature.properties || {};
    const coords = feature.geometry?.coordinates;
    
    if (!coords || coords.length < 2) {
        throw new Error('Coordonnées manquantes');
    }
    
    // Champs obligatoires : type = nom du fichier à l'import, sinon détection OSM
    const name = props.name || props['name:fr'] || props['name:en'] || 'Sans nom';
    const type = typeOverride != null ? typeOverride : extractType(props);
    const longitude = coords[0];
    const latitude = coords[1];
    
    // Champs optionnels
    const address = extractAddress(props);
    const phone = props.phone || props['contact:phone'] || null;
    const website = props.website || props['contact:website'] || props.url || null;
    const description = props.description || null;
    const openingHours = props.opening_hours || null;
    
    // Préparer les propriétés flexibles (tout le reste)
    const knownFields = [
        'name', 'name:fr', 'name:en', 'type', 'amenity', 'tourism', 'leisure', 'shop',
        'addr:housenumber', 'addr:street', 'addr:postcode', 'addr:city',
        'phone', 'contact:phone', 'website', 'contact:website', 'url',
        'description', 'opening_hours'
    ];
    
    const flexibleProps = {};
    for (const [key, value] of Object.entries(props)) {
        if (!knownFields.includes(key)) {
            flexibleProps[key] = value;
        }
    }
    
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
 * Import un fichier GeoJSON dans la base de données
 */
async function importGeoJSONFile(filePath) {
    const fileName = path.basename(filePath);
    console.log(`\n📄 Traitement de ${fileName}...`);
    
    try {
        // Lire le fichier
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const geojson = JSON.parse(fileContent);
        
        if (geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
            console.log(`⚠️  ${fileName} : Format invalide (doit être FeatureCollection)`);
            return { success: 0, errors: 1 };
        }
        
        let successCount = 0;
        let errorCount = 0;
        const errors = [];
        const fileType = typeFromFilename(filePath);
        console.log(`   Type d'activité : "${fileType}" (dérivé du nom du fichier)`);
        
        // Importer chaque feature avec le type = nom du fichier
        for (const feature of geojson.features) {
            try {
                const activityData = convertFeatureToActivity(feature, fileType);
                
                // Créer l'activité
                await prisma.activity.create({
                    data: activityData
                });
                
                successCount++;
            } catch (error) {
                errorCount++;
                errors.push({
                    name: feature.properties?.name || 'Inconnu',
                    error: error.message
                });
            }
        }
        
        console.log(`✅ ${successCount} activité(s) importée(s)`);
        if (errorCount > 0) {
            console.log(`❌ ${errorCount} erreur(s)`);
            errors.slice(0, 5).forEach(err => {
                console.log(`   - ${err.name}: ${err.error}`);
            });
            if (errors.length > 5) {
                console.log(`   ... et ${errors.length - 5} autre(s) erreur(s)`);
            }
        }
        
        return { success: successCount, errors: errorCount };
        
    } catch (error) {
        console.log(`❌ Erreur lors de la lecture de ${fileName}: ${error.message}`);
        return { success: 0, errors: 1 };
    }
}

/**
 * Crée une sauvegarde de la base de données avec horodatage
 */
function backupDatabase() {
    const dbPath = path.join(__dirname, '..', 'prisma', 'dev.db');
    const backupDir = path.join(__dirname, '..', '..', 'data', 'backup');
    
    // Vérifier si la base de données existe
    if (!fs.existsSync(dbPath)) {
        console.log('⚠️  Aucune base de données à sauvegarder\n');
        return;
    }
    
    // Créer le dossier backup s'il n'existe pas
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
        console.log('📁 Dossier backup créé\n');
    }
    
    // Créer le nom du fichier avec la date et l'heure
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    
    const backupFileName = `dev_${year}-${month}-${day}_${hours}h${minutes}.db`;
    const backupPath = path.join(backupDir, backupFileName);
    
    // Copier le fichier
    try {
        fs.copyFileSync(dbPath, backupPath);
        const stats = fs.statSync(backupPath);
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        console.log(`💾 Sauvegarde créée : ${backupFileName} (${sizeMB} MB)\n`);
    } catch (error) {
        console.error(`❌ Erreur lors de la sauvegarde : ${error.message}\n`);
    }
}

/**
 * Import tous les fichiers GeoJSON du dossier data/geojson/
 */
async function importAllGeoJSON() {
    // Chemin vers le dossier data/geojson/ à la racine du projet
    const geojsonDir = path.join(__dirname, '..', '..', 'data', 'geojson');
    
    console.log(`
╔═══════════════════════════════════════════════════╗
║                                                   ║
║       🦋 Import GeoJSON - Les Papillons          ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
    `);
    
    // Sauvegarder la base de données avant l'import
    backupDatabase();
    
    // Vérifier que le dossier existe
    if (!fs.existsSync(geojsonDir)) {
        console.log(`❌ Le dossier ${geojsonDir} n'existe pas`);
        console.log(`   Créez-le et placez-y vos fichiers .geojson`);
        process.exit(1);
    }
    
    // Lire tous les fichiers .geojson
    const files = fs.readdirSync(geojsonDir)
        .filter(file => file.endsWith('.geojson'))
        .map(file => path.join(geojsonDir, file));
    
    if (files.length === 0) {
        console.log(`⚠️  Aucun fichier .geojson trouvé dans ${geojsonDir}`);
        process.exit(0);
    }
    
    console.log(`📁 ${files.length} fichier(s) trouvé(s)\n`);
    
    // Option : Vider la base avant import (commentez si vous voulez ajouter aux données existantes)
    console.log(`🗑️  Suppression des données existantes...`);
    await prisma.favorite.deleteMany();
    await prisma.activity.deleteMany();
    console.log(`✅ Base de données vidée\n`);
    
    // Importer chaque fichier
    let totalSuccess = 0;
    let totalErrors = 0;
    
    for (const filePath of files) {
        const result = await importGeoJSONFile(filePath);
        totalSuccess += result.success;
        totalErrors += result.errors;
    }
    
    // Résumé
    console.log(`
╔═══════════════════════════════════════════════════╗
║                   RÉSUMÉ                          ║
╠═══════════════════════════════════════════════════╣
║  ✅ Activités importées : ${totalSuccess.toString().padStart(4)}                  ║
║  ❌ Erreurs             : ${totalErrors.toString().padStart(4)}                  ║
║  📁 Fichiers traités    : ${files.length.toString().padStart(4)}                  ║
╚═══════════════════════════════════════════════════╝
    `);
}

// Exécuter l'import
importAllGeoJSON()
    .catch((error) => {
        console.error('❌ Erreur fatale:', error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
