/**
 * Module Auth — Authentification Firebase Phone Auth + JWT backend
 *
 * Flux :
 *  1. sendOtp(phone)   → Firebase envoie un SMS (reCAPTCHA invisible)
 *  2. verifyOtp(code)  → Firebase vérifie → ID Token → POST /api/auth/login → JWT stocké
 *  3. isLoggedIn()     → true si JWT valide en localStorage
 *  4. onAuthRequired(cb) → affiche la popup de login, relance cb après connexion
 */

// ── Config Firebase (publique — à remplir depuis Firebase Console) ─────────────
// Project Settings > General > Your apps > Web app > firebaseConfig
const FIREBASE_CONFIG = {
    apiKey:    'AIzaSyBK8RhH9bCAYG2F4grJaMeXsL9yN3i7Iqg',
    authDomain:'beout-1d4a0.firebaseapp.com',
    appId:     '1:7987142373:web:6f2886aaec39445ffffe0c'
};

// ── État global ───────────────────────────────────────────────────────────────
let _firebaseApp          = null;
let _firebaseAuth         = null;
let _confirmationResult   = null;  // résultat de signInWithPhoneNumber
let _recaptchaVerifier    = null;
let _pendingAuthCallback  = null;  // action à relancer après connexion
let _currentUser          = null;  // { id, pseudo, avatar, phone }

// ── Initialisation ────────────────────────────────────────────────────────────

/**
 * Initialise Firebase et tente de restaurer la session depuis localStorage.
 * Appelé au chargement de la page (avant map.js).
 */
async function initAuth() {
    // Vérifier que la config Firebase est remplie
    if (!FIREBASE_CONFIG.apiKey) {
        console.warn('⚠️ Auth : FIREBASE_CONFIG non configuré. Remplir frontend/scripts/auth.js');
        _updateAccountButton();
        return;
    }

    try {
        // Importer dynamiquement le SDK Firebase (ESM via CDN)
        console.log('🔧 [initAuth] Chargement SDK Firebase...');
        const { initializeApp }           = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
        const { getAuth, RecaptchaVerifier, signInWithPhoneNumber } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');

        _firebaseApp  = initializeApp(FIREBASE_CONFIG);
        _firebaseAuth = getAuth(_firebaseApp);

        // Stocker les fonctions pour usage ultérieur
        window._fbRecaptchaVerifier    = RecaptchaVerifier;
        window._fbSignInWithPhone      = signInWithPhoneNumber;

        console.log('✅ Firebase initialisé — projet :', FIREBASE_CONFIG.authDomain);
    } catch (err) {
        console.error('❌ Firebase init :', err.code, err.message, err);
    }

    // Restaurer la session depuis localStorage
    await _restoreSession();
    _updateAccountButton();
}

/**
 * Tente de valider le JWT stocké auprès du backend
 */
async function _restoreSession() {
    const token = localStorage.getItem('auth_token');
    if (!token) return;

    try {
        const res = await fetch(`${getApiBaseUrl()}/auth/me`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
            const data = await res.json();
            _currentUser = data.user;
            console.log(`👤 Session restaurée : ${_currentUser.pseudo}`);
        } else {
            localStorage.removeItem('auth_token');
        }
    } catch {
        // Serveur inaccessible → on reste non connecté silencieusement
    }
}

// ── API publique ──────────────────────────────────────────────────────────────

/** Retourne l'utilisateur connecté ou null */
function getCurrentUser() { return _currentUser; }

/** true si une session est active */
function isLoggedIn() { return !!_currentUser; }

/** Retourne le JWT stocké */
function getAuthToken() { return localStorage.getItem('auth_token'); }

/**
 * Appelle le callback si connecté, sinon affiche la popup de login.
 * Après connexion réussie, le callback est automatiquement relancé.
 * @param {Function} callback
 */
function onAuthRequired(callback) {
    if (isLoggedIn()) {
        callback();
        return;
    }
    _pendingAuthCallback = callback;
    showLoginPopup();
}

/**
 * Déconnexion
 */
function logout() {
    localStorage.removeItem('auth_token');
    _currentUser = null;
    if (_firebaseAuth) {
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js')
            .then(({ signOut }) => signOut(_firebaseAuth).catch(() => {}));
    }
    _updateAccountButton();
    // Fermer le panneau compte s'il est ouvert
    document.getElementById('account-panel')?.classList.remove('open');
    showToast(T.TOASTS.LOGGED_OUT, 'info');
}

// ── OTP ───────────────────────────────────────────────────────────────────────

/**
 * Envoie un SMS de vérification via Firebase Phone Auth
 * @param {string} phone — numéro au format E.164 (+33612345678)
 */
async function sendOtp(phone) {
    console.log('📱 [sendOtp] Début, numéro :', phone);

    if (!_firebaseAuth) {
        console.error('❌ [sendOtp] Firebase Auth non initialisé');
        throw new Error(T.ERRORS.AUTH_UNAVAILABLE);
    }
    console.log('✅ [sendOtp] Firebase Auth OK');

    // Réinitialiser le reCAPTCHA à chaque tentative
    if (_recaptchaVerifier) {
        console.log('🔄 [sendOtp] Nettoyage reCAPTCHA existant...');
        try { await _recaptchaVerifier.clear(); console.log('✅ [sendOtp] reCAPTCHA nettoyé'); }
        catch (e) { console.warn('⚠️ [sendOtp] Erreur nettoyage reCAPTCHA :', e); }
    }

    console.log('🔧 [sendOtp] Création du reCAPTCHA invisible...');
    _recaptchaVerifier = new window._fbRecaptchaVerifier(_firebaseAuth, 'login-recaptcha-container', {
        size:     'invisible',
        callback: (token) => { console.log('✅ [reCAPTCHA] Token obtenu, longueur :', token?.length); }
    });
    console.log('✅ [sendOtp] reCAPTCHA créé');

    try {
        console.log('📤 [sendOtp] Appel signInWithPhoneNumber...');
        _confirmationResult = await window._fbSignInWithPhone(_firebaseAuth, phone, _recaptchaVerifier);
        console.log('✅ [sendOtp] SMS envoyé avec succès à', phone, '— confirmationResult :', _confirmationResult);
    } catch (err) {
        console.error('❌ [sendOtp] Échec envoi SMS :', err.code, err.message);
        const messages = {
            'auth/too-many-requests':     T.ERRORS.TOO_MANY_REQUESTS,
            'auth/invalid-phone-number':  T.ERRORS.INVALID_PHONE,
            'auth/quota-exceeded':        T.ERRORS.SMS_QUOTA,
            'auth/captcha-check-failed':  T.ERRORS.CAPTCHA_FAILED,
            'auth/network-request-failed':T.ERRORS.NETWORK
        };
        throw new Error(messages[err.code] || err.message || T.ERRORS.SMS_SEND);
    }
}

/**
 * Vérifie le code OTP saisi par l'utilisateur
 * @param {string} code — code à 6 chiffres
 */
async function verifyOtp(code) {
    console.log('🔑 [verifyOtp] Vérification du code :', code);

    if (!_confirmationResult) {
        console.error('❌ [verifyOtp] Aucun confirmationResult — sendOtp n\'a pas été appelé ?');
        throw new Error(T.ERRORS.NO_OTP_PENDING);
    }

    let result;
    try {
        console.log('📤 [verifyOtp] Appel confirm()...');
        result = await _confirmationResult.confirm(code);
        console.log('✅ [verifyOtp] Code Firebase validé, uid :', result.user.uid);
    } catch (err) {
        console.error('❌ [verifyOtp] Code incorrect ou expiré :', err.code, err.message);
        throw err;
    }

    console.log('🔐 [verifyOtp] Récupération ID Token...');
    const idToken = await result.user.getIdToken();
    console.log('✅ [verifyOtp] ID Token obtenu, longueur :', idToken.length);

    // Échanger le token Firebase contre un JWT backend
    console.log('📤 [verifyOtp] Envoi vers backend /auth/login...');
    const res = await fetch(`${getApiBaseUrl()}/auth/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ firebaseToken: idToken })
    });
    console.log('📥 [verifyOtp] Réponse backend :', res.status, res.statusText);

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('❌ [verifyOtp] Erreur backend :', err);
        throw new Error(err.message || T.ERRORS.SERVER);
    }

    const data = await res.json();
    console.log('✅ [verifyOtp] Données reçues :', data);
    localStorage.setItem('auth_token', data.token);
    _currentUser = data.user;

    console.log(`✅ Connecté : ${_currentUser.pseudo}${data.isNewUser ? ' (nouveau compte)' : ''}`);

    _updateAccountButton();
    hideLoginPopup();

    // Relancer l'action en attente
    if (_pendingAuthCallback) {
        const cb = _pendingAuthCallback;
        _pendingAuthCallback = null;
        cb();
    }

    showToast(T.TOASTS.LOGGED_IN(_currentUser.pseudo), 'success');
    return data;
}

// ── UI Popup Login ─────────────────────────────────────────────────────────────

function showLoginPopup() {
    const popup = document.getElementById('login-popup');
    if (!popup) return;
    // Bloquer le scroll du body pour éviter le décalage du header au clavier
    document.body.style.overflow = 'hidden';
    popup.classList.add('open');
    // Réinitialiser l'état
    _showLoginStep('phone');
    document.getElementById('login-phone-input')?.focus();
}

function hideLoginPopup() {
    const popup = document.getElementById('login-popup');
    popup?.classList.remove('open');
    const modal = popup?.querySelector('.login-modal');
    if (modal) modal.style.transform = '';
    // Restaurer le scroll et remettre la page en haut
    document.body.style.overflow = '';
    window.scrollTo(0, 0);
    _pendingAuthCallback = null;
}

function _showLoginStep(step) {
    document.getElementById('login-step-phone')?.classList.toggle('hidden', step !== 'phone');
    document.getElementById('login-step-otp')?.classList.toggle('hidden',   step !== 'otp');
    document.getElementById('login-error')?.classList.add('hidden');
}

function _setLoginError(msg) {
    const el = document.getElementById('login-error');
    if (el) { el.textContent = msg; el.classList.remove('hidden'); }
}

function _setLoginLoading(btn, loading) {
    btn.disabled = loading;
    btn.querySelector('.btn-text').classList.toggle('hidden', loading);
    btn.querySelector('.btn-spinner').classList.toggle('hidden', !loading);
}

/**
 * Initialise les événements de la popup de login
 */
function initLoginPopup() {
    // Fermer en cliquant sur le backdrop
    document.getElementById('login-popup')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('login-popup')) hideLoginPopup();
    });

    // Remonter le modal quand le clavier s'ouvre (mobile)
    if (window.visualViewport) {
        const _adjustForKeyboard = () => {
            const popup = document.getElementById('login-popup');
            if (!popup?.classList.contains('open')) return;
            const modal = popup.querySelector('.login-modal');
            if (!modal) return;
            const keyboardHeight = window.innerHeight - window.visualViewport.height;
            if (keyboardHeight > 80) {
                // Remonter le modal pour le garder visible au-dessus du clavier
                const shift = Math.min(keyboardHeight, window.innerHeight * 0.45);
                modal.style.transform = `translateY(-${shift}px)`;
            } else {
                modal.style.transform = '';
            }
        };
        window.visualViewport.addEventListener('resize', _adjustForKeyboard);
        window.visualViewport.addEventListener('scroll', _adjustForKeyboard);
    }

    // Fermer avec la croix
    document.getElementById('login-close')?.addEventListener('click', hideLoginPopup);

    // Étape 1 : envoyer le code
    document.getElementById('login-send-btn')?.addEventListener('click', async () => {
        const phoneInput = document.getElementById('login-phone-input');
        const btn        = document.getElementById('login-send-btn');
        let   phone      = phoneInput?.value?.trim() || '';

        // ── Mode test : taper "490" connecte directement sans Firebase ────
        if (phone === '490') {
            _setLoginLoading(btn, true);
            document.getElementById('login-error')?.classList.add('hidden');
            try {
                const res = await fetch(`${getApiBaseUrl()}/auth/login`, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ testCode: '490' })
                });
                const data = await res.json();
                if (!data.success) throw new Error(data.message);
                localStorage.setItem('auth_token', data.token);
                _currentUser = data.user;
                _updateAccountButton();
                hideLoginPopup();
                showToast(T.TOASTS.LOGGED_IN_TEST(_currentUser.pseudo), 'success');
                if (_pendingAuthCallback) { const cb = _pendingAuthCallback; _pendingAuthCallback = null; cb(); }
            } catch (err) {
                _setLoginError(err.message || T.ERRORS.TEST_CONNECTION);
            } finally {
                _setLoginLoading(btn, false);
            }
            return;
        }

        // Normalisation basique du numéro français
        if (/^0[0-9]{9}$/.test(phone.replace(/\s/g, ''))) {
            phone = '+33' + phone.replace(/\s/g, '').slice(1);
        }

        if (!/^\+[0-9]{8,15}$/.test(phone.replace(/\s/g, ''))) {
            const msg = T.ERRORS.PHONE_FORMAT;
            _setLoginError(msg);
            if (typeof showToast === 'function') showToast(msg, 'error');
            return;
        }

        _setLoginLoading(btn, true);
        document.getElementById('login-error')?.classList.add('hidden');

        try {
            await sendOtp(phone.replace(/\s/g, ''));
            _showLoginStep('otp');
            document.getElementById('login-otp-input')?.focus();
        } catch (err) {
            const msg = err.message || T.ERRORS.SMS_SEND;
            _setLoginError(msg);
            if (typeof showToast === 'function') showToast(msg, 'error');
        } finally {
            _setLoginLoading(btn, false);
        }
    });

    // Étape 2 : vérifier le code
    document.getElementById('login-verify-btn')?.addEventListener('click', async () => {
        const code = document.getElementById('login-otp-input')?.value?.trim() || '';
        const btn  = document.getElementById('login-verify-btn');

        if (!/^[0-9]{6}$/.test(code)) {
            _setLoginError(T.ERRORS.CODE_6_DIGITS);
            return;
        }

        _setLoginLoading(btn, true);
        document.getElementById('login-error')?.classList.add('hidden');

        try {
            await verifyOtp(code);
        } catch (err) {
            const msg = err.message || T.ERRORS.CODE_INVALID;
            _setLoginError(msg);
            if (typeof showToast === 'function') showToast(msg, 'error');
            _setLoginLoading(btn, false);
        }
    });

    // Retour à l'étape 1
    document.getElementById('login-back-btn')?.addEventListener('click', () => _showLoginStep('phone'));

    // Soumettre avec Entrée
    document.getElementById('login-phone-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('login-send-btn')?.click();
    });
    document.getElementById('login-otp-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('login-verify-btn')?.click();
    });
}

// ── Bouton compte dans le header ──────────────────────────────────────────────

function _updateAccountButton() {
    const btn = document.getElementById('accountBtn');
    if (!btn) return;

    const avatarUrl = typeof resolveAvatarUrl === 'function' ? resolveAvatarUrl(_currentUser?.avatar) : _currentUser?.avatar;
    if (avatarUrl) {
        btn.innerHTML = `<img src="${avatarUrl}" alt="Profil" class="account-avatar-img">`;
    } else if (_currentUser) {
        // Initiales du pseudo
        const initials = _currentUser.pseudo.slice(0, 2).toUpperCase();
        btn.innerHTML  = `<span class="account-initials">${initials}</span>`;
        btn.classList.add('logged-in');
    } else {
        btn.innerHTML = '<i class="fas fa-user-circle"></i>';
        btn.classList.remove('logged-in');
    }
}

// ── Démarrage ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    initLoginPopup();

    // Bouton compte → ouvrir panneau profil ou login
    document.getElementById('accountBtn')?.addEventListener('click', () => {
        if (isLoggedIn()) {
            // Ouvrir le panneau compte (géré dans account.js)
            if (typeof openAccountPanel === 'function') openAccountPanel();
        } else {
            showLoginPopup();
        }
    });
});
