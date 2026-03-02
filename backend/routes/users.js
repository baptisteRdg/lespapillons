const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// ─── Profil ───────────────────────────────────────────────────────────────────

/**
 * GET /api/users/me
 * Profil complet de l'utilisateur connecté
 */
router.get('/me', requireAuth, async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            include: {
                _count: {
                    select: {
                        favorites:      true,
                        todoActivities: true,
                        doneActivities: true,
                        friendships:    true
                    }
                }
            }
        });

        if (!user) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });

        res.json({
            success: true,
            user: {
                id:          user.id,
                pseudo:      user.pseudo,
                avatar:      user.avatar,
                phone:       user.phone,
                createdAt:   user.createdAt,
                lastLoginAt: user.lastLoginAt,
                counts:      user._count
            }
        });
    } catch (err) {
        console.error('Erreur GET /api/users/me:', err);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

/**
 * PUT /api/users/me
 * Modifier pseudo et/ou avatar
 * Body: { pseudo?: string, avatar?: string }
 */
router.put('/me', requireAuth, async (req, res) => {
    try {
        const { pseudo, avatar } = req.body;
        const data = {};

        if (pseudo !== undefined) {
            if (typeof pseudo !== 'string' || pseudo.trim().length < 3) {
                return res.status(400).json({ success: false, message: 'Le pseudo doit faire au moins 3 caractères' });
            }
            // Vérifier l'unicité
            const existing = await prisma.user.findFirst({
                where: { pseudo: pseudo.trim(), NOT: { id: req.user.id } }
            });
            if (existing) {
                return res.status(409).json({ success: false, message: 'Ce pseudo est déjà pris' });
            }
            data.pseudo = pseudo.trim();
        }

        if (avatar !== undefined) {
            data.avatar = avatar || null;
        }

        const user = await prisma.user.update({ where: { id: req.user.id }, data });

        res.json({
            success: true,
            user: { id: user.id, pseudo: user.pseudo, avatar: user.avatar, phone: user.phone }
        });
    } catch (err) {
        console.error('Erreur PUT /api/users/me:', err);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// ─── Amis ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/users/me/friends
 * Liste des amis + demandes reçues en attente
 */
router.get('/me/friends', requireAuth, async (req, res) => {
    try {
        const [friendships, pendingRequests] = await Promise.all([
            prisma.friendship.findMany({
                where: { userId: req.user.id },
                include: { friend: { select: { id: true, pseudo: true, avatar: true } } }
            }),
            prisma.friendRequest.findMany({
                where:   { toId: req.user.id, status: 'pending' },
                include: { from: { select: { id: true, pseudo: true, avatar: true } } }
            })
        ]);

        res.json({
            success:  true,
            friends:  friendships.map(f => f.friend),
            requests: pendingRequests.map(r => ({ id: r.id, from: r.from, createdAt: r.createdAt }))
        });
    } catch (err) {
        console.error('Erreur GET /api/users/me/friends:', err);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

/**
 * POST /api/users/friends/request/:pseudo
 * Envoyer une demande d'amis à un utilisateur par son pseudo
 */
router.post('/friends/request/:pseudo', requireAuth, async (req, res) => {
    try {
        const target = await prisma.user.findUnique({ where: { pseudo: req.params.pseudo } });

        if (!target) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
        if (target.id === req.user.id) return res.status(400).json({ success: false, message: 'Vous ne pouvez pas vous ajouter vous-même' });

        // Vérifier si déjà amis
        const alreadyFriends = await prisma.friendship.findUnique({
            where: { userId_friendId: { userId: req.user.id, friendId: target.id } }
        });
        if (alreadyFriends) return res.status(409).json({ success: false, message: 'Déjà amis' });

        // Vérifier si demande déjà envoyée
        const existing = await prisma.friendRequest.findUnique({
            where: { fromId_toId: { fromId: req.user.id, toId: target.id } }
        });
        if (existing) return res.status(409).json({ success: false, message: 'Demande déjà envoyée' });

        // Vérifier si la personne nous a déjà envoyé une demande → accepter directement
        const reverse = await prisma.friendRequest.findUnique({
            where: { fromId_toId: { fromId: target.id, toId: req.user.id } }
        });

        if (reverse && reverse.status === 'pending') {
            // Accepter la demande inverse → créer l'amitié des deux côtés
            await prisma.$transaction([
                prisma.friendRequest.update({ where: { id: reverse.id }, data: { status: 'accepted' } }),
                prisma.friendship.create({ data: { userId: req.user.id,  friendId: target.id } }),
                prisma.friendship.create({ data: { userId: target.id, friendId: req.user.id  } })
            ]);
            return res.json({ success: true, message: 'Demande acceptée — vous êtes maintenant amis !' });
        }

        await prisma.friendRequest.create({ data: { fromId: req.user.id, toId: target.id } });
        res.json({ success: true, message: `Demande envoyée à ${target.pseudo}` });
    } catch (err) {
        console.error('Erreur POST /api/users/friends/request:', err);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

/**
 * PUT /api/users/friends/requests/:requestId
 * Accepter ou refuser une demande d'amis
 * Body: { action: 'accept' | 'reject' }
 */
router.put('/friends/requests/:requestId', requireAuth, async (req, res) => {
    try {
        const request = await prisma.friendRequest.findUnique({ where: { id: req.params.requestId } });

        if (!request || request.toId !== req.user.id) {
            return res.status(404).json({ success: false, message: 'Demande introuvable' });
        }
        if (request.status !== 'pending') {
            return res.status(400).json({ success: false, message: 'Demande déjà traitée' });
        }

        const { action } = req.body;

        if (action === 'accept') {
            await prisma.$transaction([
                prisma.friendRequest.update({ where: { id: request.id }, data: { status: 'accepted' } }),
                prisma.friendship.create({ data: { userId: request.fromId, friendId: request.toId } }),
                prisma.friendship.create({ data: { userId: request.toId,  friendId: request.fromId } })
            ]);
            res.json({ success: true, message: 'Demande acceptée' });
        } else {
            await prisma.friendRequest.update({ where: { id: request.id }, data: { status: 'rejected' } });
            res.json({ success: true, message: 'Demande refusée' });
        }
    } catch (err) {
        console.error('Erreur PUT /api/users/friends/requests:', err);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

/**
 * DELETE /api/users/friends/:friendId
 * Supprimer un ami (supprime l'amitié des deux côtés)
 */
router.delete('/friends/:friendId', requireAuth, async (req, res) => {
    try {
        await prisma.$transaction([
            prisma.friendship.deleteMany({ where: { userId: req.user.id,       friendId: req.params.friendId } }),
            prisma.friendship.deleteMany({ where: { userId: req.params.friendId, friendId: req.user.id } })
        ]);
        res.json({ success: true, message: 'Ami supprimé' });
    } catch (err) {
        console.error('Erreur DELETE /api/users/friends:', err);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// ─── Activités à faire ────────────────────────────────────────────────────────

/**
 * GET /api/users/me/todo
 */
router.get('/me/todo', requireAuth, async (req, res) => {
    try {
        const items = await prisma.todoActivity.findMany({
            where:   { userId: req.user.id },
            include: { activity: { select: { id: true, name: true, type: true, latitude: true, longitude: true } } },
            orderBy: { createdAt: 'desc' }
        });
        res.json({ success: true, data: items.map(i => ({ ...i.activity, addedAt: i.createdAt })) });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

/**
 * GET /api/users/me/todo/:activityId — vérifie si l'activité est dans la liste
 */
router.get('/me/todo/:activityId', requireAuth, async (req, res) => {
    try {
        const activityId = parseInt(req.params.activityId);
        const item = await prisma.todoActivity.findUnique({
            where: { userId_activityId: { userId: req.user.id, activityId } }
        });
        res.json({ success: true, inTodo: !!item });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

/**
 * POST /api/users/me/todo/:activityId
 */
router.post('/me/todo/:activityId', requireAuth, async (req, res) => {
    try {
        const activityId = parseInt(req.params.activityId);
        await prisma.todoActivity.upsert({
            where:  { userId_activityId: { userId: req.user.id, activityId } },
            create: { userId: req.user.id, activityId },
            update: {}
        });
        res.json({ success: true, message: 'Ajouté à la liste à faire' });
    } catch (err) {
        if (err.code === 'P2003') return res.status(404).json({ success: false, message: 'Activité introuvable' });
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

/**
 * DELETE /api/users/me/todo/:activityId
 */
router.delete('/me/todo/:activityId', requireAuth, async (req, res) => {
    try {
        const activityId = parseInt(req.params.activityId);
        await prisma.todoActivity.deleteMany({ where: { userId: req.user.id, activityId } });
        res.json({ success: true, message: 'Retiré de la liste à faire' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// ─── Activités réalisées ──────────────────────────────────────────────────────

/**
 * GET /api/users/me/done
 */
router.get('/me/done', requireAuth, async (req, res) => {
    try {
        const items = await prisma.doneActivity.findMany({
            where:   { userId: req.user.id },
            include: {
                activity: { select: { id: true, name: true, type: true, latitude: true, longitude: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Charger les notes associées
        const activityIds = items.map(i => i.activityId);
        const ratings = await prisma.rating.findMany({
            where: { userId: req.user.id, activityId: { in: activityIds } }
        });
        const ratingsMap = Object.fromEntries(ratings.map(r => [r.activityId, r.value]));

        res.json({
            success: true,
            data: items.map(i => ({
                ...i.activity,
                doneAt: i.createdAt,
                rating: ratingsMap[i.activityId] ?? null
            }))
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

/**
 * DELETE /api/users/me/done/:activityId
 * Retire des activités réalisées ET supprime la note associée
 */
router.delete('/me/done/:activityId', requireAuth, async (req, res) => {
    try {
        const activityId = parseInt(req.params.activityId);
        await prisma.$transaction([
            prisma.doneActivity.deleteMany({ where: { userId: req.user.id, activityId } }),
            prisma.rating.deleteMany({ where: { userId: req.user.id, activityId } })
        ]);
        res.json({ success: true, message: 'Retiré des activités réalisées (note supprimée)' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

module.exports = router;
