/**
 * Textes statiques de l'application — source unique.
 * Modifier ici pour changer tous les libellés du front.
 * Facilite aussi une future traduction (i18n).
 *
 * Usage : T.TOASTS.NETWORK_ERROR  ou  T.RATING_LABELS[3]
 */
const T = Object.freeze({

    // ── Application ──────────────────────────────────────────────────────────
    APP_NAME: 'BeOut',
    PAGE_TITLE: 'Trouvez des activités à faire partout en France',

    // ── Toasts / notifications ───────────────────────────────────────────────
    TOASTS: Object.freeze({
        NETWORK_ERROR:       'Erreur réseau',
        NETWORK_CHECK:       'Erreur réseau — vérifie ta connexion',
        SERVER_ERROR:        'Erreur serveur',
        LOAD_ERROR:          'Erreur lors du chargement',
        ERROR:               'Erreur',

        FAVORITE_ADDED:      'Ajouté aux favoris',
        FAVORITE_REMOVED:    'Retiré des favoris',
        TODO_ADDED:          'Ajouté',
        TODO_REMOVED:        'Retiré',

        RATING_SUCCESS:      (label) => `Note : ${label}`,

        SEARCH_NO_RESULTS:   (term) => `Aucune activité trouvée pour « ${term} »`,
        SEARCH_RESULTS:      (n) => `${n} activité(s) trouvée(s)`,
        SEARCH_CITY_FOUND:   (label) => `Ville trouvée : ${label}`,
        SEARCH_ADDRESS_FOUND:(label) => `Adresse trouvée : ${label}`,

        LINK_COPIED:         'Lien copié dans le presse-papier',
        LINK_FALLBACK:       (url) => `Lien : ${url}`,
        SIMILAR_SOON:        'Bientôt disponible — restez connectés',
        ACTIVITY_NOT_FOUND:  'Activité introuvable',

        LOGGED_IN:           (pseudo) => `Connecté en tant que ${pseudo}`,
        LOGGED_IN_TEST:      (pseudo) => `Connecté (test) : ${pseudo}`,
        LOGGED_OUT:          'Déconnecté',

        PSEUDO_TOO_SHORT:    'Pseudo trop court (3 caractères minimum)',
        PSEUDO_UPDATED:      'Pseudo mis à jour',

        IMAGE_TOO_LARGE:     'Image trop volumineuse (max 8 Mo)',
        NO_FILE:             'Aucun fichier sélectionné',
        AUTH_REQUIRED_AVATAR:'Il faut être connecté pour changer ta photo',
        AVATAR_UPDATED:      'Photo mise à jour',
        UPLOAD_ERROR:        'Erreur lors de l\'upload',
        SERVER_ERROR_IMAGE:  (status) => `Erreur serveur (HTTP ${status}) — image peut-être trop grande`,

        FRIEND_REQUEST_SENT: 'Demande envoyée',
        FRIEND_REMOVED:      'Ami supprimé',
        GROUP_CREATED:       'Groupe créé',
        GROUP_MEMBER_ADDED:  'Membre ajouté au groupe',
        GROUP_ACTIVITY_ADDED:'Activité ajoutée au groupe',
        GROUP_ACTIVITY_REMOVED:'Activité retirée du groupe',
        GROUP_VIEW_ENABLED:  (name) => `Vue groupe activée : ${name}`,
        GROUP_VIEW_DISABLED: 'Vue groupe désactivée',
        REMOVED:             'Retiré',
        DEFAULT:             'Action réussie !',
    }),

    // ── Erreurs (modale login, etc.) ─────────────────────────────────────────
    ERRORS: Object.freeze({
        AUTH_UNAVAILABLE:    'Service d\'authentification indisponible. Vérifiez votre connexion.',
        TOO_MANY_REQUESTS:   'Trop de tentatives. Réessayez plus tard.',
        INVALID_PHONE:       'Numéro de téléphone invalide.',
        SMS_QUOTA:           'Quota SMS dépassé. Réessayez plus tard.',
        CAPTCHA_FAILED:      'Vérification reCAPTCHA échouée. Rechargez la page.',
        NETWORK:             'Erreur réseau. Vérifiez votre connexion.',
        SMS_SEND:            'Erreur lors de l\'envoi du SMS',
        NO_OTP_PENDING:      'Aucun OTP en attente',
        SERVER:              'Erreur serveur',
        TEST_CONNECTION:     'Erreur connexion test',
        PHONE_FORMAT:        'Numéro invalide. Format : 06 XX XX XX XX',
        CODE_6_DIGITS:       'Le code doit contenir 6 chiffres',
        CODE_INVALID:        'Code incorrect ou expiré',
    }),

    // ── Boutons ──────────────────────────────────────────────────────────────
    BUTTONS: Object.freeze({
        ADD:             'Ajouter',
        FAVORITE:        'Favori',
        TODO:            'À faire',
        TODO_CHECKED:    'À faire ✓',
        ITINERARY:       'Itinéraire',
        SIMILAR:         'Similaires',
        SHARE:           'Partager',
        ADD_TO_GROUP:    'Ajouter au groupe',
        CLOSE:           'Fermer',
        SAVE:            'Enregistrer',
        CANCEL:          'Annuler',
        SEND_CODE:       'Recevoir le code SMS',
        VERIFY_CODE:     'Valider le code',
        CHANGE_PHONE:    'Changer de numéro',
        CHANGE_PHOTO:    'Changer la photo',
        EDIT_PSEUDO:     'Modifier le pseudo',
        CREATE_GROUP:    'Créer',
        OPEN_GROUP:      'Ouvrir',
        VIEW_ON_MAP:     'Voir sur la carte',
        ADD_MEMBER:      'Ajouter membre',
        EXIT_GROUP_VIEW: 'Quitter la vue',
        CREATE_AND_ADD:  'Créer et ajouter',
        LOGOUT:          'Se déconnecter',
        REMOVE:          'Retirer',
        DELETE:           'Supprimer',
        SENDING:         'Envoi…',
    }),

    // ── Labels / titres ──────────────────────────────────────────────────────
    LABELS: Object.freeze({
        MY_FAVORITES:    'Mes Favoris',
        MY_ACCOUNT:      'Mon compte',
        LOGIN:           'Connexion / Création de compte',
        LOGIN_SUBTITLE:  'Entre ton numéro de téléphone pour te connecter ou créer un compte en une seule étape',
        PHONE:           'Numéro de téléphone',
        OTP_CODE:        'Code reçu par SMS',
        FRIENDS:         'Amis',
        GROUPS:          'Groupes',
        TODO:            'À faire',
        DONE:            'Réalisées',
        CLOSE:           'Fermer',
        FRIEND_REQUESTS: 'Demandes reçues',
        VISIT_WEBSITE:   'Visiter le site web',
        CATEGORY_OTHER:  'Autre',
        SEARCH:          'Rechercher une activité, une ville ou une adresse',
        LEGAL:           'En continuant, tu acceptes nos conditions d\'utilisation. Ton numéro ne sera jamais partagé.',
        STYLE_PICKER:    'Changer le style de la carte',
        PICK_GROUP:      'Ajouter à un groupe',
        AVATAR_HINT:     'Clique ou dépose une image<br><small>JPEG · PNG · WebP · GIF — max 8 Mo</small>',
        AVATAR_PREVIEW:  'Aperçu',
        NEW_PSEUDO:      'Nouveau pseudo (3 caractères min)',
        FRIEND_PSEUDO:   'Pseudo de ton ami',
        GROUP_NAME:      'Nom du groupe',
    }),

    // ── Placeholders ─────────────────────────────────────────────────────────
    PLACEHOLDERS: Object.freeze({
        PHONE:     '+33 6 12 34 56 78',
        OTP:       '123456',
        SEARCH:    'Rechercher une activité, une ville ou une adresse',
        PSEUDO:    'Nouveau pseudo (3 caractères min)',
        FRIEND:    'Pseudo de ton ami',
        GROUP_NAME:'Nom du groupe',
    }),

    // ── États vides ──────────────────────────────────────────────────────────
    EMPTY: Object.freeze({
        FAVORITES:  'Aucun favori pour le moment',
        FRIENDS:    'Aucun ami pour l\'instant',
        GROUPS:     'Aucun groupe pour l\'instant',
        GROUP_ACTIVITIES: 'Aucune activité dans ce groupe',
        TODO:       'Aucune activité à faire',
        DONE:       'Aucune activité réalisée',
    }),

    // ── Chargement ───────────────────────────────────────────────────────────
    LOADING: 'Chargement…',

    // ── Notation ─────────────────────────────────────────────────────────────
    RATING_LABELS: Object.freeze(['', 'Déconseille', 'Pas fan', 'Normal', 'Bien', 'Recommande']),

    // ── Styles de carte ──────────────────────────────────────────────────────
    MAP_STYLES: Object.freeze({
        papillon:  'Papillon',
        satellite: 'Satellite',
        nuit:      'Nuit',
        simple:    'Simple',
        propre:    'Propre',
    }),
});

/**
 * Résout une clé de type "LABELS.LOGIN" en parcourant l'objet T.
 * Retourne undefined si la clé n'existe pas.
 */
function _resolveT(key) {
    return key.split('.').reduce((obj, k) => obj?.[k], T);
}

/**
 * Applique les textes de T sur le DOM.
 *   data-t="LABELS.LOGIN"            → textContent
 *   data-t-html="LABELS.AVATAR_HINT" → innerHTML (pour le <br> etc.)
 *   data-t-placeholder="PLACEHOLDERS.PHONE"
 *   data-t-title="LABELS.STYLE_PICKER"
 *   data-t-aria="LABELS.LOGIN"       → aria-label
 */
function applyTexts() {
    document.querySelectorAll('[data-t]').forEach(el => {
        const v = _resolveT(el.dataset.t);
        if (v !== undefined) el.textContent = v;
    });
    document.querySelectorAll('[data-t-html]').forEach(el => {
        const v = _resolveT(el.dataset.tHtml);
        if (v !== undefined) el.innerHTML = v;
    });
    document.querySelectorAll('[data-t-placeholder]').forEach(el => {
        const v = _resolveT(el.dataset.tPlaceholder);
        if (v !== undefined) el.placeholder = v;
    });
    document.querySelectorAll('[data-t-title]').forEach(el => {
        const v = _resolveT(el.dataset.tTitle);
        if (v !== undefined) el.title = v;
    });
    document.querySelectorAll('[data-t-aria]').forEach(el => {
        const v = _resolveT(el.dataset.tAria);
        if (v !== undefined) el.setAttribute('aria-label', v);
    });
}

document.addEventListener('DOMContentLoaded', applyTexts);
