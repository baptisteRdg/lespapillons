const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

/**
 * POST /api/ratings
 * Crée ou met à jour la note d'un utilisateur pour une activité.
 * Bascule automatiquement l'activité dans "réalisée".
 *
 * Body: { activityId: number, value: number (1-5) }
 */
router.post('/', requireAuth, async (req, res) => {
    try {
        const { activityId, value } = req.body;
        const numValue = parseInt(value);

        if (!activityId || isNaN(numValue) || numValue < 1 || numValue > 5) {
            return res.status(400).json({ success: false, message: 'activityId et value (1-5) sont requis' });
        }

        const actId = parseInt(activityId);

        // Vérifier que l'activité existe
        const activity = await prisma.activity.findUnique({ where: { id: actId } });
        if (!activity) return res.status(404).json({ success: false, message: 'Activité introuvable' });

        // Créer ou mettre à jour la note + basculer en "réalisée" (upsert pour les deux)
        const [rating] = await prisma.$transaction([
            prisma.rating.upsert({
                where:  { userId_activityId: { userId: req.user.id, activityId: actId } },
                create: { userId: req.user.id, activityId: actId, value: numValue },
                update: { value: numValue }
            }),
            prisma.doneActivity.upsert({
                where:  { userId_activityId: { userId: req.user.id, activityId: actId } },
                create: { userId: req.user.id, activityId: actId },
                update: {}
            }),
            // Retirer de "à faire" si elle y était
            prisma.todoActivity.deleteMany({ where: { userId: req.user.id, activityId: actId } })
        ]);

        // Calculer la nouvelle moyenne
        const avgResult = await prisma.rating.aggregate({
            where:   { activityId: actId },
            _avg:    { value: true },
            _count:  { value: true }
        });

        res.json({
            success:    true,
            message:    'Note enregistrée',
            rating:     { value: numValue, activityId: actId },
            average:    avgResult._avg.value ? Math.round(avgResult._avg.value * 10) / 10 : null,
            totalVotes: avgResult._count.value
        });
    } catch (err) {
        console.error('Erreur POST /api/ratings:', err);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

/**
 * GET /api/ratings/activity/:activityId
 * Retourne la note de l'utilisateur courant + la moyenne globale pour une activité.
 * Auth optionnelle (userRating = null si non connecté)
 */
router.get('/activity/:activityId', optionalAuth, async (req, res) => {
    try {
        const actId = parseInt(req.params.activityId);

        const [avgResult, userRating] = await Promise.all([
            prisma.rating.aggregate({
                where:  { activityId: actId },
                _avg:   { value: true },
                _count: { value: true }
            }),
            req.user
                ? prisma.rating.findUnique({ where: { userId_activityId: { userId: req.user.id, activityId: actId } } })
                : Promise.resolve(null)
        ]);

        res.json({
            success:    true,
            userRating: userRating?.value ?? null,
            average:    avgResult._avg.value ? Math.round(avgResult._avg.value * 10) / 10 : null,
            totalVotes: avgResult._count.value
        });
    } catch (err) {
        console.error('Erreur GET /api/ratings/activity/:id:', err);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

module.exports = router;
