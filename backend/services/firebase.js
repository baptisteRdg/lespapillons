const admin = require('firebase-admin');

let initialized = false;

/**
 * Initialise Firebase Admin SDK (singleton)
 * Les credentials viennent du .env
 */
function initFirebase() {
    if (initialized) return;

    const { FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL } = process.env;

    if (!FIREBASE_PROJECT_ID || !FIREBASE_PRIVATE_KEY || !FIREBASE_CLIENT_EMAIL) {
        console.warn('⚠️  Firebase Admin : variables d\'environnement manquantes. L\'authentification téléphone sera désactivée.');
        return;
    }

    admin.initializeApp({
        credential: admin.credential.cert({
            projectId:   FIREBASE_PROJECT_ID,
            privateKey:  FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            clientEmail: FIREBASE_CLIENT_EMAIL
        })
    });

    initialized = true;
    console.log('✅ Firebase Admin initialisé');
}

/**
 * Vérifie un Firebase ID Token et retourne les infos utilisateur
 * @param {string} idToken - Token Firebase renvoyé par le client après OTP
 * @returns {Promise<{phone_number: string, uid: string}>}
 */
async function verifyFirebaseToken(idToken) {
    if (!initialized) {
        throw new Error('Firebase Admin non initialisé. Vérifiez le fichier .env');
    }

    const decodedToken = await admin.auth().verifyIdToken(idToken);

    if (!decodedToken.phone_number) {
        throw new Error('Token Firebase valide mais sans numéro de téléphone');
    }

    return {
        uid:          decodedToken.uid,
        phone_number: decodedToken.phone_number
    };
}

module.exports = { initFirebase, verifyFirebaseToken };
