#!/usr/bin/env node
/**
 * Tests de santé globaux — vérifie que toute la stack fonctionne.
 *
 * Usage :  node tests/health.js [BASE_URL]
 * Défaut : http://localhost:3000
 *
 * Teste : front statique, API back, base de données, auth, cohérence données.
 */

const BASE      = process.argv[2] || 'http://localhost:3000';
const FRONT_URL = process.argv[3] || BASE; // en dev : node health.js http://localhost:3000 http://localhost:5500
const API       = `${BASE}/api`;

const passed  = [];
const failed  = [];
const skipped = [];

// ── Helpers ──────────────────────────────────────────────────────────────────

async function test(name, fn) {
    const t0 = Date.now();
    try {
        await fn();
        const ms = Date.now() - t0;
        passed.push({ name, ms });
        console.log(`  ✅  ${name}  (${ms} ms)`);
    } catch (err) {
        const ms = Date.now() - t0;
        failed.push({ name, ms, error: err.message });
        console.log(`  ❌  ${name}  (${ms} ms) — ${err.message}`);
    }
}

async function testOptional(name, fn) {
    const t0 = Date.now();
    try {
        await fn();
        const ms = Date.now() - t0;
        passed.push({ name, ms });
        console.log(`  ✅  ${name}  (${ms} ms)`);
    } catch {
        const ms = Date.now() - t0;
        skipped.push({ name, ms });
        console.log(`  ⏭️  ${name}  (skip — non servi en dev)`);
    }
}

function assert(condition, msg) {
    if (!condition) throw new Error(msg || 'Assertion failed');
}

async function fetchJson(url, opts = {}) {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000), ...opts });
    const body = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, body };
}

async function fetchStatus(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    return res.status;
}

// ── Tests ────────────────────────────────────────────────────────────────────

async function run() {
    console.log(`\n🩺  Tests de santé — API: ${BASE}  Front: ${FRONT_URL}\n`);
    console.log('── Frontend ────────────────────────────────');

    await testOptional('Front : index.html accessible', async () => {
        const status = await fetchStatus(FRONT_URL);
        assert(status === 200, `HTTP ${status}`);
    });

    await testOptional('Front : main.css accessible', async () => {
        const status = await fetchStatus(`${FRONT_URL}/styles/main.css`);
        assert(status === 200, `HTTP ${status}`);
    });

    await testOptional('Front : variables.css accessible', async () => {
        const status = await fetchStatus(`${FRONT_URL}/styles/variables.css`);
        assert(status === 200, `HTTP ${status}`);
    });

    await testOptional('Front : texts.js accessible', async () => {
        const status = await fetchStatus(`${FRONT_URL}/scripts/texts.js`);
        assert(status === 200, `HTTP ${status}`);
    });

    await testOptional('Front : map.js accessible', async () => {
        const status = await fetchStatus(`${FRONT_URL}/scripts/map.js`);
        assert(status === 200, `HTTP ${status}`);
    });

    console.log('\n── Backend API ─────────────────────────────');

    await test('API : racine répond', async () => {
        const { status, body } = await fetchJson(`${API.replace('/api', '')}/`);
        assert(status === 200, `HTTP ${status}`);
        assert(body && body.version, 'Pas de champ version');
    });

    await test('API : GET /api/activities (liste)', async () => {
        const { status, body } = await fetchJson(`${API}/activities`);
        assert(status === 200, `HTTP ${status}`);
        assert(body.success === true, 'success !== true');
        assert(Array.isArray(body.data), 'data n\'est pas un tableau');
        assert(body.count >= 0, 'count manquant');
    });

    await test('API : les activités ont les champs requis', async () => {
        const { body } = await fetchJson(`${API}/activities`);
        if (body.data.length === 0) throw new Error('Aucune activité en BDD — ne peut pas vérifier');
        const a = body.data[0];
        assert(a.id !== undefined, 'id manquant');
        assert(a.name, 'name manquant');
        assert(a.latitude !== undefined, 'latitude manquant');
        assert(a.longitude !== undefined, 'longitude manquant');
        assert(a.type, 'type manquant');
    });

    await test('API : GET /api/activities/:id (détail)', async () => {
        const list = await fetchJson(`${API}/activities`);
        if (!list.body.data.length) throw new Error('Aucune activité');
        const id = list.body.data[0].id;
        const { status, body } = await fetchJson(`${API}/activities/${id}`);
        assert(status === 200, `HTTP ${status}`);
        assert(body.success === true, 'success !== true');
        assert(body.data.id === id, 'ID ne correspond pas');
    });

    await test('API : 404 sur activité inexistante', async () => {
        const { status } = await fetchJson(`${API}/activities/999999`);
        assert(status === 404, `Attendu 404, reçu ${status}`);
    });

    await test('API : filtre par type fonctionne', async () => {
        const list = await fetchJson(`${API}/activities`);
        if (!list.body.data.length) throw new Error('Aucune activité');
        const type = list.body.data[0].type;
        const { body } = await fetchJson(`${API}/activities?type=${encodeURIComponent(type)}`);
        assert(body.data.every(a => a.type.toLowerCase() === type.toLowerCase()), 'Filtre type incorrect');
    });

    await test('API : recherche textuelle fonctionne', async () => {
        const list = await fetchJson(`${API}/activities`);
        if (!list.body.data.length) throw new Error('Aucune activité');
        const term = list.body.data[0].name.slice(0, 4);
        const { body } = await fetchJson(`${API}/activities?search=${encodeURIComponent(term)}`);
        assert(body.success === true, 'success !== true');
        assert(body.data.length > 0, `Aucun résultat pour "${term}"`);
    });

    console.log('\n── Base de données ─────────────────────────');

    await test('BDD : nombre d\'activités > 0', async () => {
        const { body } = await fetchJson(`${API}/activities`);
        assert(body.count > 0, `Seulement ${body.count} activités`);
    });

    await test('BDD : coordonnées valides (lat/lng)', async () => {
        const { body } = await fetchJson(`${API}/activities`);
        for (const a of body.data.slice(0, 20)) {
            assert(a.latitude >= -90 && a.latitude <= 90, `lat invalide : ${a.latitude} (id=${a.id})`);
            assert(a.longitude >= -180 && a.longitude <= 180, `lng invalide : ${a.longitude} (id=${a.id})`);
        }
    });

    await test('BDD : pas de doublons d\'ID', async () => {
        const { body } = await fetchJson(`${API}/activities`);
        const ids = body.data.map(a => a.id);
        const unique = new Set(ids);
        assert(ids.length === unique.size, `${ids.length - unique.size} doublons`);
    });

    console.log('\n── Authentification ────────────────────────');

    await test('Auth : POST /api/auth/login (test code 490)', async () => {
        const { status, body } = await fetchJson(`${API}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ testCode: '490' })
        });
        assert(status === 200, `HTTP ${status}`);
        assert(body.success === true, body.message || 'login échoué');
        assert(body.token, 'token manquant');
        assert(body.user, 'user manquant');
    });

    await test('Auth : GET /api/auth/me avec JWT', async () => {
        const login = await fetchJson(`${API}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ testCode: '490' })
        });
        const token = login.body.token;
        const { status, body } = await fetchJson(`${API}/auth/me`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        assert(status === 200, `HTTP ${status}`);
        assert(body.user, 'user manquant');
    });

    await test('Auth : rejet sans token', async () => {
        const { status } = await fetchJson(`${API}/users/me/todo`);
        assert(status === 401, `Attendu 401, reçu ${status}`);
    });

    console.log('\n── Routes protégées ────────────────────────');

    const login = await fetchJson(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testCode: '490' })
    });
    const authHeaders = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${login.body?.token}`
    };

    await test('User : GET /api/users/me/todo', async () => {
        const { status, body } = await fetchJson(`${API}/users/me/todo`, { headers: authHeaders });
        assert(status === 200, `HTTP ${status}`);
        assert(body.success === true, 'success !== true');
    });

    await test('User : GET /api/users/me/done', async () => {
        const { status, body } = await fetchJson(`${API}/users/me/done`, { headers: authHeaders });
        assert(status === 200, `HTTP ${status}`);
        assert(body.success === true, 'success !== true');
    });

    await test('Ratings : GET /api/ratings/activity/:id', async () => {
        const list = await fetchJson(`${API}/activities`);
        if (!list.body.data.length) throw new Error('Aucune activité');
        const id = list.body.data[0].id;
        const { status } = await fetchJson(`${API}/ratings/activity/${id}`, { headers: authHeaders });
        assert(status === 200, `HTTP ${status}`);
    });

    // ── Résumé ───────────────────────────────────────────────────────────────

    console.log('\n══════════════════════════════════════════════');
    console.log(`  ✅ Réussis : ${passed.length}`);
    if (skipped.length) console.log(`  ⏭️  Skips  : ${skipped.length}`);
    console.log(`  ❌ Échoués : ${failed.length}`);
    console.log('══════════════════════════════════════════════\n');

    if (failed.length) {
        console.log('Détail des échecs :');
        for (const f of failed) {
            console.log(`  • ${f.name} — ${f.error}`);
        }
        console.log('');
    }

    process.exit(failed.length ? 1 : 0);
}

run().catch(err => {
    console.error('\n💥 Erreur fatale :', err.message);
    process.exit(2);
});
