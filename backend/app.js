require('dotenv').config();

const express = require('express');
const cors = require('cors');
const dns = require('dns');
const net = require('net');
const { PrismaClient } = require('@prisma/client');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./swagger.json');
const {
    geojsonToActivity,
    activityToGeojson,
    geojsonCollectionToActivities,
    activitiesToGeojsonCollection
} = require('./helpers/geojson');
const { initFirebase } = require('./services/firebase');
const { requireAuth } = require('./middleware/auth');

// Initialiser Firebase Admin au démarrage
initFirebase();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

// Middleware
app.set('trust proxy', 1); // Nginx envoie X-Forwarded-For → Express lit la vraie IP client
app.use(cors());
app.use(express.json());

// ── Rate limiting ────────────────────────────────────────────────────────────
// Souple : ne bloque que les abus automatisés, pas les vrais utilisateurs.
// Localhost exempté (dev local + benchmarks).
const isLocalhost = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip);

const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    skip: isLocalhost,
    message: { success: false, message: 'Trop de requêtes, réessayez dans quelques secondes' }
});
const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    skip: isLocalhost,
    message: { success: false, message: 'Trop de tentatives de connexion, réessayez dans une minute' }
});
const proxyLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
    skip: isLocalhost,
    message: { success: false, message: 'Trop de requêtes proxy, réessayez dans quelques secondes' }
});
app.use('/api/', globalLimiter);
app.use('/api/auth/', authLimiter);
app.use('/api/og-image', proxyLimiter);

// Fichiers uploadés (avatars, etc.) servis via /api/uploads (passe par la route /api de Nginx)
app.use('/api/uploads', require('express').static(require('path').join(__dirname, 'uploads')));

// Logger simple pour toutes les requêtes
app.use((req, res, next) => {
    console.log(`📥 ${req.method} ${req.path}`);
    next();
});

// Nouvelles routes
app.use('/api/auth',    require('./routes/auth'));
app.use('/api/users',   require('./routes/users'));
app.use('/api/ratings', require('./routes/ratings'));
app.use('/api/upload',  require('./routes/upload'));

// Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: "Les Papillons API"
}));

/**
 * Calcule la distance entre deux points géographiques (formule de Haversine)
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
 * Route principale
 */
app.get('/', (req, res) => {
    res.json({
        message: "API Les Papillons - Découvrez Paris",
        version: "2.0.0",
        documentation: `http://localhost:${PORT}/api-docs`,
        endpoints: {
            activities: "GET /api/activities",
            activityById: "GET /api/activities/:id",
            createActivity: "POST /api/activities",
            updateActivity: "PUT /api/activities/:id",
            deleteActivity: "DELETE /api/activities/:id",
            favorites: "GET /api/favorites",
            addFavorite: "POST /api/favorites",
            removeFavorite: "DELETE /api/favorites/:activityId"
        }
    });
});

/**
 * GET /api/activities
 * Récupère toutes les activités avec filtres optionnels
 * OPTIMISÉ : Ne renvoie que les champs minimaux (id, name, latitude, longitude, type)
 */
app.get('/api/activities', async (req, res) => {
    try {
        const { type, lat, lng, search, bbox, limitPerType } = req.query;
        
        // Récupérer uniquement les champs nécessaires pour l'affichage sur la carte
        let activities = await prisma.activity.findMany({
            select: {
                id: true,
                name: true,
                latitude: true,
                longitude: true,
                type: true
            },
            orderBy: { createdAt: 'desc' }
        });
        
        // Filtrer par type si spécifié
        if (type) {
            activities = activities.filter(a => 
                a.type.toLowerCase() === type.toLowerCase()
            );
        }
        
        // Filtrer par terme de recherche (nom ou type) si spécifié
        if (search) {
            const term = search.toLowerCase().trim();
            activities = activities.filter(a =>
                a.name.toLowerCase().includes(term) ||
                a.type.toLowerCase().includes(term)
            );
        }

        // Filtrer par bounding box (minLat,minLng,maxLat,maxLng)
        if (bbox) {
            const parts = bbox.split(',').map(parseFloat);
            if (parts.length === 4 && parts.every(n => !isNaN(n))) {
                const [minLat, minLng, maxLat, maxLng] = parts;
                activities = activities.filter(a =>
                    a.latitude  >= minLat && a.latitude  <= maxLat &&
                    a.longitude >= minLng && a.longitude <= maxLng
                );
            }
        }
        
        // Si lat/lng fournis, calculer la distance pour chaque activité
        if (lat && lng) {
            const centerLat = parseFloat(lat);
            const centerLng = parseFloat(lng);
            
            // Ajouter la distance à chaque activité
            activities = activities.map(activity => ({
                ...activity,
                distance: calculateDistance(
                    centerLat, centerLng,
                    activity.latitude, activity.longitude
                )
            }));
            
            // Trier par distance (plus proche en premier)
            activities.sort((a, b) => a.distance - b.distance);
            
            // Fallback : sans recherche texte, sans bbox → limiter à 100
            if (!search && !bbox) {
                activities = activities.slice(0, 100);
            }
            
            // Supprimer le champ distance avant de renvoyer
            activities = activities.map(({ distance, ...activity }) => activity);
        }

        // Limiter le nombre de résultats par type (pour éviter la surcharge visuelle)
        if (limitPerType) {
            const limit = parseInt(limitPerType, 10);
            if (!isNaN(limit) && limit > 0) {
                const countByType = {};
                activities = activities.filter(a => {
                    countByType[a.type] = (countByType[a.type] || 0) + 1;
                    return countByType[a.type] <= limit;
                });
            }
        }
        
        res.json({
            success: true,
            count: activities.length,
            data: activities
        });
    } catch (error) {
        console.error('Erreur GET /api/activities:', error.message || error);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération des activités"
        });
    }
});

/**
 * GET /api/activities/:id
 * Récupère une activité spécifique par son ID
 */
app.get('/api/activities/:id', async (req, res) => {
    try {
        const activityId = parseInt(req.params.id);
        
        const [activity, avgResult] = await Promise.all([
            prisma.activity.findUnique({ where: { id: activityId } }),
            prisma.rating.aggregate({
                where:  { activityId },
                _avg:   { value: true },
                _count: { value: true }
            })
        ]);
        
        if (!activity) {
            return res.status(404).json({
                success: false,
                message: "Activité non trouvée"
            });
        }

        const avgRating    = avgResult._avg.value ? Math.round(avgResult._avg.value * 10) / 10 : null;
        const totalRatings = avgResult._count.value;
        
        res.json({
            success: true,
            data:    { ...activity, avgRating, totalRatings }
        });
    } catch (error) {
        console.error('Erreur GET /api/activities/:id:', error);
        res.status(500).json({
            success: false,
            message: "Erreur serveur"
        });
    }
});

/**
 * POST /api/activities
 * Crée une nouvelle activité
 */
app.post('/api/activities', requireAuth, async (req, res) => {
    try {
        const { name, type, latitude, longitude, address, phone, website, description, openingHours, properties } = req.body;
        
        // Validation des champs obligatoires
        if (!name || !type || latitude === undefined || longitude === undefined) {
            return res.status(400).json({
                success: false,
                message: "Les champs name, type, latitude et longitude sont obligatoires"
            });
        }
        
        // Créer l'activité
        const activity = await prisma.activity.create({
            data: {
                name,
                type,
                latitude: parseFloat(latitude),
                longitude: parseFloat(longitude),
                address: address || null,
                phone: phone || null,
                website: website || null,
                description: description || null,
                openingHours: openingHours || null,
                properties: properties ? JSON.stringify(properties) : null
            }
        });
        
        res.status(201).json({
            success: true,
            message: "Activité créée avec succès",
            data: activity
        });
    } catch (error) {
        console.error('Erreur POST /api/activities:', error);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la création"
        });
    }
});

/**
 * POST /api/activities/import/geojson
 * Importe des activités depuis un GeoJSON (Feature ou FeatureCollection)
 */
app.post('/api/activities/import/geojson', requireAuth, async (req, res) => {
    try {
        const geojson = req.body;
        
        let activitiesToCreate = [];
        let conversionErrors = null;
        
        // Gérer FeatureCollection
        if (geojson.type === 'FeatureCollection') {
            const result = geojsonCollectionToActivities(geojson);
            activitiesToCreate = result.success;
            conversionErrors = result.errors;
        }
        // Gérer Feature unique
        else if (geojson.type === 'Feature') {
            try {
                activitiesToCreate = [geojsonToActivity(geojson)];
            } catch (error) {
                return res.status(400).json({
                    success: false,
                    message: "Erreur de conversion GeoJSON",
                    error: error.message
                });
            }
        }
        else {
            return res.status(400).json({
                success: false,
                message: "Format GeoJSON invalide : doit être Feature ou FeatureCollection"
            });
        }
        
        // Insérer dans la base de données
        const created = [];
        const dbErrors = [];
        
        for (const activityData of activitiesToCreate) {
            try {
                const activity = await prisma.activity.create({
                    data: activityData
                });
                created.push(activity);
            } catch (error) {
                dbErrors.push({
                    activity: activityData.name,
                    error: error.message
                });
            }
        }
        
        res.status(201).json({
            success: true,
            message: `${created.length} activité(s) importée(s)`,
            data: {
                imported: created,
                summary: {
                    total: activitiesToCreate.length,
                    success: created.length,
                    failed: dbErrors.length
                },
                ...(conversionErrors && { conversionErrors }),
                ...(dbErrors.length > 0 && { dbErrors })
            }
        });
    } catch (error) {
        console.error('Erreur POST /api/activities/import/geojson:', error);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de l'import",
            error: error.message
        });
    }
});

/**
 * GET /api/activities/export/geojson
 * Exporte toutes les activités au format GeoJSON FeatureCollection
 */
app.get('/api/activities/export/geojson', async (req, res) => {
    try {
        const activities = await prisma.activity.findMany({
            orderBy: { createdAt: 'desc' }
        });
        
        const geojson = activitiesToGeojsonCollection(activities);
        
        res.json(geojson);
    } catch (error) {
        console.error('Erreur GET /api/activities/export/geojson:', error);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de l'export"
        });
    }
});

/**
 * PUT /api/activities/:id
 * Met à jour une activité existante
 */
app.put('/api/activities/:id', requireAuth, async (req, res) => {
    try {
        const activityId = parseInt(req.params.id);
        const { name, type, latitude, longitude, address, phone, website, description, openingHours } = req.body;
        
        // Vérifier que l'activité existe
        const existing = await prisma.activity.findUnique({
            where: { id: activityId }
        });
        
        if (!existing) {
            return res.status(404).json({
                success: false,
                message: "Activité non trouvée"
            });
        }
        
        // Préparer les données à mettre à jour
        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (type !== undefined) updateData.type = type;
        if (latitude !== undefined) updateData.latitude = parseFloat(latitude);
        if (longitude !== undefined) updateData.longitude = parseFloat(longitude);
        if (address !== undefined) updateData.address = address;
        if (phone !== undefined) updateData.phone = phone;
        if (website !== undefined) updateData.website = website;
        if (description !== undefined) updateData.description = description;
        if (openingHours !== undefined) updateData.openingHours = openingHours;
        if (req.body.properties !== undefined) {
            updateData.properties = req.body.properties ? JSON.stringify(req.body.properties) : null;
        }
        
        // Mettre à jour
        const activity = await prisma.activity.update({
            where: { id: activityId },
            data: updateData
        });
        
        res.json({
            success: true,
            message: "Activité mise à jour avec succès",
            data: activity
        });
    } catch (error) {
        console.error('Erreur PUT /api/activities/:id:', error);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la mise à jour"
        });
    }
});

/**
 * DELETE /api/activities/:id
 * Supprime une activité
 */
app.delete('/api/activities/:id', requireAuth, async (req, res) => {
    try {
        const activityId = parseInt(req.params.id);
        
        // Vérifier que l'activité existe
        const existing = await prisma.activity.findUnique({
            where: { id: activityId }
        });
        
        if (!existing) {
            return res.status(404).json({
                success: false,
                message: "Activité non trouvée"
            });
        }
        
        // Supprimer (les favoris associés seront supprimés automatiquement grâce à onDelete: Cascade)
        await prisma.activity.delete({
            where: { id: activityId }
        });
        
        res.json({
            success: true,
            message: "Activité supprimée avec succès"
        });
    } catch (error) {
        console.error('Erreur DELETE /api/activities/:id:', error);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la suppression"
        });
    }
});

/**
 * Vérifie si une adresse IP est privée/locale (anti-SSRF)
 */
function isPrivateIP(ip) {
    if (net.isIPv4(ip)) {
        const parts = ip.split('.').map(Number);
        return (
            parts[0] === 127 ||                                    // 127.0.0.0/8
            parts[0] === 10 ||                                     // 10.0.0.0/8
            (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || // 172.16.0.0/12
            (parts[0] === 192 && parts[1] === 168) ||              // 192.168.0.0/16
            (parts[0] === 169 && parts[1] === 254) ||              // 169.254.0.0/16 (link-local)
            parts[0] === 0                                         // 0.0.0.0/8
        );
    }
    if (net.isIPv6(ip)) {
        const normalized = ip.toLowerCase();
        return (
            normalized === '::1' ||
            normalized.startsWith('fc') || normalized.startsWith('fd') || // ULA
            normalized.startsWith('fe80')                                  // link-local
        );
    }
    return false;
}

/**
 * GET /api/og-image?url=...
 * Proxy côté serveur : récupère l'image og:image (ou twitter:image) d'une URL tierce.
 * Nécessaire car le navigateur ne peut pas lire le HTML d'autres domaines (CORS).
 */
app.get('/api/og-image', async (req, res) => {
    const { url } = req.query;
    if (!url) {
        return res.status(400).json({ imageUrl: null, error: 'url manquante' });
    }

    // Valider que l'URL est http/https
    let targetUrl;
    try {
        targetUrl = new URL(url);
        if (!['http:', 'https:'].includes(targetUrl.protocol)) throw new Error();
    } catch {
        return res.status(400).json({ imageUrl: null, error: 'url invalide' });
    }

    // Anti-SSRF : résoudre le hostname et bloquer les IPs privées/locales
    try {
        const { address } = await dns.promises.lookup(targetUrl.hostname);
        if (isPrivateIP(address)) {
            return res.status(403).json({ imageUrl: null, error: 'adresse non autorisée' });
        }
    } catch {
        return res.status(400).json({ imageUrl: null, error: 'hostname non résolu' });
    }

    try {
        const response = await fetch(targetUrl.toString(), {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; LesPapillons-Bot/1.0)',
                'Accept': 'text/html'
            },
            signal: AbortSignal.timeout(6000),
            redirect: 'follow'
        });

        if (!response.ok) {
            return res.json({ imageUrl: null });
        }

        // Lire seulement les premiers 50 Ko pour ne pas charger de gros fichiers
        const reader = response.body.getReader();
        let html = '';
        let bytesRead = 0;
        const MAX_BYTES = 50000;
        while (bytesRead < MAX_BYTES) {
            const { done, value } = await reader.read();
            if (done) break;
            html += new TextDecoder().decode(value);
            bytesRead += value.byteLength;
        }
        reader.cancel();

        // Chercher og:image (les deux ordres d'attributs possibles)
        const ogPatterns = [
            /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
            /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
            /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
            /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i
        ];

        let imageUrl = null;
        for (const pattern of ogPatterns) {
            const match = html.match(pattern);
            if (match?.[1]) {
                imageUrl = match[1].trim();
                // Résoudre les URL relatives
                if (imageUrl.startsWith('//')) imageUrl = targetUrl.protocol + imageUrl;
                else if (imageUrl.startsWith('/')) imageUrl = `${targetUrl.protocol}//${targetUrl.host}${imageUrl}`;
                break;
            }
        }

        console.log(`🖼️ og-image pour ${targetUrl.hostname}: ${imageUrl ?? 'aucune'}`);
        res.json({ imageUrl });

    } catch (error) {
        console.error(`❌ og-image erreur pour ${url}:`, error.message);
        res.json({ imageUrl: null });
    }
});

/**
 * GET /api/favorites
 * Récupère les favoris d'un utilisateur avec les détails des activités
 */
app.get('/api/favorites', async (req, res) => {
    try {
        const { userId = 'default-user' } = req.query;
        
        const favorites = await prisma.favorite.findMany({
            where: { userId },
            include: {
                activity: true // Inclure les détails de l'activité
            },
            orderBy: { createdAt: 'desc' }
        });
        
        res.json({
            success: true,
            count: favorites.length,
            data: favorites
        });
    } catch (error) {
        console.error('Erreur GET /api/favorites:', error);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération des favoris"
        });
    }
});

/**
 * POST /api/favorites
 * Ajoute une activité aux favoris
 */
app.post('/api/favorites', async (req, res) => {
    try {
        const { activityId, userId = 'default-user' } = req.body;
        
        // Validation
        if (!activityId) {
            return res.status(400).json({
                success: false,
                message: "L'ID de l'activité est requis"
            });
        }
        
        // Vérifier que l'activité existe
        const activity = await prisma.activity.findUnique({
            where: { id: activityId }
        });
        
        if (!activity) {
            return res.status(404).json({
                success: false,
                message: "Activité non trouvée"
            });
        }
        
        // Vérifier si déjà en favoris
        const existing = await prisma.favorite.findUnique({
            where: {
                userId_activityId: {
                    userId,
                    activityId
                }
            }
        });
        
        if (existing) {
            return res.status(409).json({
                success: false,
                message: "Cette activité est déjà dans vos favoris"
            });
        }
        
        // Créer le favori
        const favorite = await prisma.favorite.create({
            data: {
                userId,
                activityId
            },
            include: {
                activity: true
            }
        });
        
        res.status(201).json({
            success: true,
            message: "Activité ajoutée aux favoris !",
            data: favorite
        });
    } catch (error) {
        console.error('Erreur POST /api/favorites:', error);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de l'ajout aux favoris"
        });
    }
});

/**
 * DELETE /api/favorites/:activityId
 * Retire une activité des favoris
 */
app.delete('/api/favorites/:activityId', async (req, res) => {
    try {
        const activityId = parseInt(req.params.activityId);
        const { userId = 'default-user' } = req.query;
        
        // Trouver le favori
        const favorite = await prisma.favorite.findUnique({
            where: {
                userId_activityId: {
                    userId,
                    activityId
                }
            }
        });
        
        if (!favorite) {
            return res.status(404).json({
                success: false,
                message: "Favori non trouvé"
            });
        }
        
        // Supprimer le favori
        await prisma.favorite.delete({
            where: {
                id: favorite.id
            }
        });
        
        res.json({
            success: true,
            message: "Activité retirée des favoris"
        });
    } catch (error) {
        console.error('Erreur DELETE /api/favorites/:activityId:', error);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la suppression du favori"
        });
    }
});

/**
 * Route 404
 */
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "Route non trouvée"
    });
});

/**
 * Gestionnaire d'erreurs global
 */
app.use((err, req, res, next) => {
    console.error('Erreur serveur:', err.message || err);
    console.error(err.stack);
    res.status(500).json({
        success: false,
        message: "Une erreur est survenue sur le serveur"
    });
});

/**
 * Démarrage du serveur
 */
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════╗
║                                                   ║
║       🦋 API Les Papillons - Base de Données     ║
║                                                   ║
║   Serveur démarré avec succès !                  ║
║   URL: http://localhost:${PORT}                      ║
║   Swagger: http://localhost:${PORT}/api-docs        ║
║                                                   ║
║   Base de données: SQLite + Prisma               ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
    `);
    console.log(`⏰ Démarré le ${new Date().toLocaleString('fr-FR')}`);
});

// Fermer proprement la connexion Prisma à l'arrêt du serveur
process.on('SIGINT', async () => {
    await prisma.$disconnect();
    process.exit(0);
});

module.exports = app;
