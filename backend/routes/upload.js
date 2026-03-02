/**
 * Route d'upload d'avatar — sécurisée
 *
 * Sécurités en place :
 *  1. Authentification JWT obligatoire (requireAuth)
 *  2. Multer stocke en mémoire (memoryStorage) → rien n'est écrit sur le disque avant validation
 *  3. Limite de taille : 5 Mo (rejetée avant même d'arriver dans le handler)
 *  4. Filtre MIME déclaré : seuls image/jpeg, image/png, image/webp, image/gif sont acceptés
 *  5. Sharp relit les octets bruts : si le fichier n'est pas une vraie image, il lève une erreur
 *     → protection contre les fichiers renommés (.php.jpg, scripts déguisés, etc.)
 *  6. Sharp redimensionne à max 400×400 et convertit en WebP → taille finale toujours petite
 *  7. Nom de fichier : userId + timestamp + extension .webp → pas d'injection de chemin possible
 *  8. L'ancien avatar est supprimé du disque à chaque mise à jour
 */

const express  = require('express');
const multer   = require('multer');
const sharp    = require('sharp');
const path     = require('path');
const fs       = require('fs');
const { PrismaClient } = require('@prisma/client');
const { requireAuth }  = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// ── Dossier de destination ────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'avatars');

// S'assurer que le dossier existe (création automatique si absent)
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ── Configuration Multer ──────────────────────────────────────────────────────
// image/x-png : variante envoyée par certains navigateurs/OS pour les .PNG
const ALLOWED_MIMES = new Set([
    'image/jpeg', 'image/jpg',
    'image/png',  'image/x-png',
    'image/webp',
    'image/gif'
]);
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 Mo

const upload = multer({
    storage: multer.memoryStorage(), // tout en RAM, rien sur le disque avant validation
    limits:  { fileSize: MAX_SIZE_BYTES },
    fileFilter(_req, file, cb) {
        // Normaliser en minuscules pour gérer image/PNG, image/JPEG, etc.
        if (ALLOWED_MIMES.has(file.mimetype.toLowerCase())) {
            cb(null, true);
        } else {
            cb(new Error('Type de fichier non autorisé. Acceptés : JPEG, PNG, WebP, GIF'));
        }
    }
});

// ── POST /api/upload/avatar ───────────────────────────────────────────────────

/**
 * Uploader / remplacer l'avatar de l'utilisateur connecté.
 * Champ multipart attendu : "avatar" (fichier unique)
 */
router.post('/avatar', requireAuth, upload.single('avatar'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'Aucun fichier reçu' });
    }

    try {
        // ── Validation réelle par Sharp (lit les magic bytes) ─────────────────
        // Si le fichier n'est pas une vraie image, sharp lève une exception
        let imageBuffer;
        try {
            imageBuffer = await sharp(req.file.buffer)
                .resize(400, 400, {
                    fit:           'cover',      // recadrage centré
                    position:      'centre',
                    withoutEnlargement: true     // ne pas agrandir une petite image
                })
                .webp({ quality: 82 })           // WebP ~82 % → bon ratio qualité/poids
                .toBuffer();
        } catch {
            return res.status(400).json({
                success: false,
                message: 'Le fichier envoyé n\'est pas une image valide'
            });
        }

        // ── Nom de fichier sûr ────────────────────────────────────────────────
        // userId est un cuid (alphanumérique + tirets), pas d'injection possible
        const filename    = `${req.user.id}_${Date.now()}.webp`;
        const filepath    = path.join(UPLOAD_DIR, filename);
        const publicUrl   = `/uploads/avatars/${filename}`;

        // ── Écriture sur le disque ────────────────────────────────────────────
        await fs.promises.writeFile(filepath, imageBuffer);

        // ── Supprimer l'ancien avatar (si c'est un fichier local) ─────────────
        const currentUser = await prisma.user.findUnique({ where: { id: req.user.id } });
        if (currentUser?.avatar) {
            const oldPath = _localPathFromUrl(currentUser.avatar);
            if (oldPath) {
                fs.promises.unlink(oldPath).catch(() => {}); // silencieux si déjà absent
            }
        }

        // ── Mettre à jour la DB ───────────────────────────────────────────────
        const updated = await prisma.user.update({
            where: { id: req.user.id },
            data:  { avatar: publicUrl }
        });

        console.log(`🖼️  Avatar mis à jour — user: ${req.user.id} → ${filename}`);

        res.json({
            success:   true,
            avatarUrl: publicUrl,
            user:      { id: updated.id, pseudo: updated.pseudo, avatar: updated.avatar }
        });

    } catch (err) {
        console.error('Erreur POST /api/upload/avatar:', err);
        res.status(500).json({ success: false, message: 'Erreur serveur lors de l\'upload' });
    }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convertit une URL publique locale (/uploads/avatars/xxx.webp)
 * en chemin absolu sur le disque.
 * Renvoie null si l'URL est externe (pas notre fichier local).
 */
function _localPathFromUrl(url) {
    if (!url || !url.startsWith('/uploads/avatars/')) return null;
    // Extraire uniquement le nom de fichier pour éviter toute traversée de chemin
    const basename = path.basename(url);
    return path.join(UPLOAD_DIR, basename);
}

// ── Gestionnaire d'erreurs Multer ─────────────────────────────────────────────
router.use((err, _req, res, _next) => {
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
            success: false,
            message: `Image trop volumineuse (maximum : ${MAX_SIZE_BYTES / 1024 / 1024} Mo)`
        });
    }
    res.status(400).json({ success: false, message: err.message || 'Erreur upload' });
});

module.exports = router;
