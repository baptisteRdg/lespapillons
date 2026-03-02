const express = require('express');
const jwt     = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { verifyFirebaseToken } = require('../services/firebase');

const router = express.Router();
const prisma = new PrismaClient();

/**
 * Génère un pseudo unique par défaut (user_XXXX)
 */
async function generateDefaultPseudo() {
    let pseudo;
    let exists = true;
    while (exists) {
        const rand = Math.floor(1000 + Math.random() * 9000);
        pseudo = `user_${rand}`;
        const found = await prisma.user.findUnique({ where: { pseudo } });
        exists = !!found;
    }
    return pseudo;
}

/**
 * POST /api/auth/login
 * Reçoit un Firebase ID Token, vérifie et crée/connecte l'utilisateur.
 * Retourne un JWT propre + infos utilisateur.
 *
 * Body: { firebaseToken: string }
 */
router.post('/login', async (req, res) => {
    try {
        const { firebaseToken, testCode } = req.body;

        let phone;

        // ── Mode test : code 490 bypass Firebase ──────────────────────────
        if (testCode === '490') {
            phone = '+33000000490';
            console.log('🧪 Connexion test via code 490');
        } else {
            // ── Mode normal : vérification Firebase ───────────────────────
            if (!firebaseToken) {
                return res.status(400).json({ success: false, message: 'firebaseToken requis' });
            }

            let firebaseUser;
            try {
                firebaseUser = await verifyFirebaseToken(firebaseToken);
            } catch (err) {
                console.error('❌ Erreur vérification Firebase:', err.message);
                return res.status(401).json({ success: false, message: 'Token Firebase invalide : ' + err.message });
            }

            phone = firebaseUser.phone_number;
        }

        // 2. Créer ou retrouver l'utilisateur dans la DB
        let isNewUser = false;
        let user = await prisma.user.findUnique({ where: { phone } });

        if (!user) {
            isNewUser = true;
            const pseudo = await generateDefaultPseudo();
            user = await prisma.user.create({
                data: { phone, pseudo }
            });
            console.log(`👤 Nouvel utilisateur créé : ${pseudo} (${phone})`);
        }

        // 3. Mettre à jour la date de dernière connexion
        user = await prisma.user.update({
            where: { id: user.id },
            data:  { lastLoginAt: new Date() }
        });

        // 4. Émettre un JWT propre (expire dans 30 jours)
        const token = jwt.sign(
            { id: user.id, phone: user.phone, pseudo: user.pseudo },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        console.log(`✅ Connexion : ${user.pseudo} (${phone})`);

        res.json({
            success: true,
            token,
            isNewUser,
            user: {
                id:     user.id,
                pseudo: user.pseudo,
                avatar: user.avatar,
                phone:  user.phone
            }
        });
    } catch (err) {
        console.error('Erreur POST /api/auth/login:', err);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

/**
 * GET /api/auth/me
 * Retourne le profil de l'utilisateur courant depuis le JWT.
 * Utilisé au chargement pour restaurer la session.
 */
router.get('/me', async (req, res) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Non authentifié' });
    }

    try {
        const payload = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
        const user    = await prisma.user.findUnique({ where: { id: payload.id } });

        if (!user) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });

        res.json({
            success: true,
            user: {
                id:     user.id,
                pseudo: user.pseudo,
                avatar: user.avatar,
                phone:  user.phone
            }
        });
    } catch {
        res.status(401).json({ success: false, message: 'Token invalide' });
    }
});

module.exports = router;
