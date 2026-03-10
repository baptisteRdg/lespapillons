const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

function formatGroup(group, currentUserId) {
    return {
        id: group.id,
        name: group.name,
        owner: group.owner,
        ownerId: group.ownerId,
        isOwner: group.ownerId === currentUserId,
        members: group.members.map((m) => ({
            id: m.user.id,
            pseudo: m.user.pseudo,
            avatar: m.user.avatar,
            joinedAt: m.joinedAt
        })),
        activities: group.activities.map((entry) => ({
            id: entry.activity.id,
            name: entry.activity.name,
            type: entry.activity.type,
            latitude: entry.activity.latitude,
            longitude: entry.activity.longitude,
            addedAt: entry.addedAt
        })),
        memberCount: group.members.length,
        activityCount: group.activities.length,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt
    };
}

async function findGroupIfMember(groupId, userId) {
    return prisma.group.findFirst({
        where: {
            id: groupId,
            OR: [
                { ownerId: userId },
                { members: { some: { userId } } }
            ]
        },
        include: {
            owner: { select: { id: true, pseudo: true, avatar: true } },
            members: {
                include: { user: { select: { id: true, pseudo: true, avatar: true } } },
                orderBy: { joinedAt: 'asc' }
            },
            activities: {
                include: {
                    activity: {
                        select: {
                            id: true,
                            name: true,
                            type: true,
                            latitude: true,
                            longitude: true
                        }
                    }
                },
                orderBy: { addedAt: 'desc' }
            }
        }
    });
}

/**
 * GET /api/groups
 * Liste les groupes de l'utilisateur connecté (propriétaire ou membre).
 */
router.get('/', requireAuth, async (req, res) => {
    try {
        const groups = await prisma.group.findMany({
            where: {
                OR: [
                    { ownerId: req.user.id },
                    { members: { some: { userId: req.user.id } } }
                ]
            },
            include: {
                owner: { select: { id: true, pseudo: true, avatar: true } },
                members: {
                    include: { user: { select: { id: true, pseudo: true, avatar: true } } },
                    orderBy: { joinedAt: 'asc' }
                },
                activities: {
                    include: {
                        activity: {
                            select: {
                                id: true,
                                name: true,
                                type: true,
                                latitude: true,
                                longitude: true
                            }
                        }
                    },
                    orderBy: { addedAt: 'desc' }
                }
            },
            orderBy: { updatedAt: 'desc' }
        });

        res.json({
            success: true,
            count: groups.length,
            data: groups.map((g) => formatGroup(g, req.user.id))
        });
    } catch (err) {
        console.error('Erreur GET /api/groups:', err);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

/**
 * GET /api/groups/:groupId
 * Détail d'un groupe (accessible uniquement aux membres/propriétaire).
 */
router.get('/:groupId', requireAuth, async (req, res) => {
    try {
        const group = await findGroupIfMember(req.params.groupId, req.user.id);
        if (!group) {
            return res.status(404).json({
                success: false,
                message: 'Groupe introuvable ou accès refusé'
            });
        }

        res.json({ success: true, data: formatGroup(group, req.user.id) });
    } catch (err) {
        console.error('Erreur GET /api/groups/:groupId:', err);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

/**
 * POST /api/groups
 * Crée un groupe et ajoute automatiquement le créateur comme membre.
 * Body: { name: string, memberIds?: string[] }
 */
router.post('/', requireAuth, async (req, res) => {
    try {
        const { name, memberIds } = req.body;
        const cleanName = typeof name === 'string' ? name.trim() : '';

        if (cleanName.length < 2) {
            return res.status(400).json({
                success: false,
                message: 'Le nom du groupe doit contenir au moins 2 caractères'
            });
        }

        const invitedIds = Array.isArray(memberIds)
            ? [...new Set(memberIds.filter((id) => typeof id === 'string' && id !== req.user.id))]
            : [];

        if (invitedIds.length) {
            const [users, friendships] = await Promise.all([
                prisma.user.findMany({
                    where: { id: { in: invitedIds } },
                    select: { id: true }
                }),
                prisma.friendship.findMany({
                    where: { userId: req.user.id, friendId: { in: invitedIds } },
                    select: { friendId: true }
                })
            ]);

            const existingUserIds = new Set(users.map((u) => u.id));
            const unknownUserId = invitedIds.find((id) => !existingUserIds.has(id));
            if (unknownUserId) {
                return res.status(404).json({
                    success: false,
                    message: 'Un utilisateur invité est introuvable'
                });
            }

            const friendIds = new Set(friendships.map((f) => f.friendId));
            const notFriends = invitedIds.filter((id) => !friendIds.has(id));
            if (notFriends.length) {
                return res.status(403).json({
                    success: false,
                    message: 'Vous ne pouvez inviter que des amis'
                });
            }
        }

        const group = await prisma.$transaction(async (tx) => {
            const createdGroup = await tx.group.create({
                data: {
                    name: cleanName,
                    ownerId: req.user.id
                }
            });

            await tx.groupMember.create({
                data: { groupId: createdGroup.id, userId: req.user.id }
            });

            if (invitedIds.length) {
                await tx.groupMember.createMany({
                    data: invitedIds.map((userId) => ({ groupId: createdGroup.id, userId }))
                });
            }

            return createdGroup;
        });

        const fullGroup = await findGroupIfMember(group.id, req.user.id);
        res.status(201).json({
            success: true,
            message: 'Groupe créé avec succès',
            data: formatGroup(fullGroup, req.user.id)
        });
    } catch (err) {
        console.error('Erreur POST /api/groups:', err);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

/**
 * POST /api/groups/:groupId/members
 * Ajoute un membre dans le groupe (sans validation), uniquement si c'est un ami.
 * Body: { userId: string }
 */
router.post('/:groupId/members', requireAuth, async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId || typeof userId !== 'string') {
            return res.status(400).json({ success: false, message: 'userId requis' });
        }

        const group = await findGroupIfMember(req.params.groupId, req.user.id);
        if (!group) {
            return res.status(404).json({
                success: false,
                message: 'Groupe introuvable ou accès refusé'
            });
        }

        const target = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true }
        });
        if (!target) {
            return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
        }

        const alreadyInGroup = group.ownerId === userId || group.members.some((m) => m.userId === userId);
        if (alreadyInGroup) {
            return res.status(409).json({ success: false, message: 'Utilisateur déjà membre du groupe' });
        }

        const friendship = await prisma.friendship.findUnique({
            where: { userId_friendId: { userId: req.user.id, friendId: userId } }
        });
        if (!friendship) {
            return res.status(403).json({
                success: false,
                message: 'Vous ne pouvez ajouter que des amis'
            });
        }

        await prisma.groupMember.create({
            data: { groupId: group.id, userId }
        });

        const updated = await findGroupIfMember(group.id, req.user.id);
        res.json({
            success: true,
            message: 'Membre ajouté au groupe',
            data: formatGroup(updated, req.user.id)
        });
    } catch (err) {
        if (err.code === 'P2002') {
            return res.status(409).json({ success: false, message: 'Utilisateur déjà membre du groupe' });
        }
        console.error('Erreur POST /api/groups/:groupId/members:', err);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

/**
 * POST /api/groups/:groupId/activities/:activityId
 * Ajoute une activité au groupe (accessible aux membres/propriétaire).
 */
router.post('/:groupId/activities/:activityId', requireAuth, async (req, res) => {
    try {
        const activityId = parseInt(req.params.activityId, 10);
        if (Number.isNaN(activityId)) {
            return res.status(400).json({ success: false, message: 'activityId invalide' });
        }

        const group = await findGroupIfMember(req.params.groupId, req.user.id);
        if (!group) {
            return res.status(404).json({
                success: false,
                message: 'Groupe introuvable ou accès refusé'
            });
        }

        await prisma.groupActivity.create({
            data: { groupId: group.id, activityId }
        });

        const updated = await findGroupIfMember(group.id, req.user.id);
        res.json({
            success: true,
            message: 'Activité ajoutée au groupe',
            data: formatGroup(updated, req.user.id)
        });
    } catch (err) {
        if (err.code === 'P2002') {
            return res.status(409).json({ success: false, message: 'Activité déjà présente dans le groupe' });
        }
        if (err.code === 'P2003') {
            return res.status(404).json({ success: false, message: 'Activité introuvable' });
        }
        console.error('Erreur POST /api/groups/:groupId/activities/:activityId:', err);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

/**
 * DELETE /api/groups/:groupId/activities/:activityId
 * Retire une activité d'un groupe (accessible aux membres/propriétaire).
 */
router.delete('/:groupId/activities/:activityId', requireAuth, async (req, res) => {
    try {
        const activityId = parseInt(req.params.activityId, 10);
        if (Number.isNaN(activityId)) {
            return res.status(400).json({ success: false, message: 'activityId invalide' });
        }

        const group = await findGroupIfMember(req.params.groupId, req.user.id);
        if (!group) {
            return res.status(404).json({
                success: false,
                message: 'Groupe introuvable ou accès refusé'
            });
        }

        await prisma.groupActivity.deleteMany({
            where: { groupId: group.id, activityId }
        });

        const updated = await findGroupIfMember(group.id, req.user.id);
        res.json({
            success: true,
            message: 'Activité retirée du groupe',
            data: formatGroup(updated, req.user.id)
        });
    } catch (err) {
        console.error('Erreur DELETE /api/groups/:groupId/activities/:activityId:', err);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

module.exports = router;
