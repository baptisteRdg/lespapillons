const jwt = require('jsonwebtoken');

/**
 * Middleware d'authentification obligatoire.
 * Vérifie le JWT dans Authorization: Bearer <token>.
 * Attache req.user = { id, phone, pseudo } sur la requête si valide.
 */
function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Non authentifié' });
    }

    const token = header.split(' ')[1];
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({ success: false, message: 'Token invalide ou expiré' });
    }
}

/**
 * Middleware d'authentification optionnel.
 * Tente de décoder le JWT, attache req.user si présent et valide, continue sinon.
 */
function optionalAuth(req, res, next) {
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
        const token = header.split(' ')[1];
        try {
            req.user = jwt.verify(token, process.env.JWT_SECRET);
        } catch {
            // Token invalide → on continue sans utilisateur
        }
    }
    next();
}

module.exports = { requireAuth, optionalAuth };
