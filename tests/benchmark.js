#!/usr/bin/env node
/**
 * Benchmark de performance — mesure les temps de réponse et le débit.
 *
 * Usage :  node tests/benchmark.js [BASE_URL] [CONCURRENCY]
 * Défaut : http://localhost:3000   10
 *
 * Produit un score global pour comparer entre machines / optimisations.
 * Les résultats sont aussi sauvegardés dans tests/benchmark-history.json.
 */

const BASE        = process.argv[2] || 'http://localhost:3000';
const API         = `${BASE}/api`;
const CONCURRENCY = parseInt(process.argv[3]) || 10;
const ROUNDS      = 20; // requêtes par test

const results = {};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function timedFetch(url, opts = {}) {
    const t0 = performance.now();
    const res = await fetch(url, { signal: AbortSignal.timeout(15000), ...opts });
    const body = await res.text();
    return { ms: performance.now() - t0, status: res.status, size: body.length };
}

function stats(timings) {
    const sorted = [...timings].sort((a, b) => a - b);
    const sum  = sorted.reduce((s, v) => s + v, 0);
    return {
        min:  Math.round(sorted[0]),
        max:  Math.round(sorted[sorted.length - 1]),
        avg:  Math.round(sum / sorted.length),
        p50:  Math.round(sorted[Math.floor(sorted.length * 0.5)]),
        p95:  Math.round(sorted[Math.floor(sorted.length * 0.95)]),
        p99:  Math.round(sorted[Math.floor(sorted.length * 0.99)]),
    };
}

async function bench(name, fn, rounds = ROUNDS) {
    process.stdout.write(`  ⏱  ${name} ...`);
    const timings = [];
    const errors  = [];

    for (let i = 0; i < rounds; i++) {
        try {
            const ms = await fn();
            timings.push(ms);
        } catch (err) {
            errors.push(err.message);
        }
    }

    if (!timings.length) {
        console.log(` ❌ ${errors.length} erreurs`);
        results[name] = { error: true };
        return;
    }

    const s = stats(timings);
    results[name] = s;
    console.log(` avg=${s.avg}ms  p50=${s.p50}ms  p95=${s.p95}ms  min=${s.min}ms  max=${s.max}ms`);
}

async function benchConcurrent(name, fn, concurrency = CONCURRENCY, totalRequests = ROUNDS) {
    process.stdout.write(`  ⚡ ${name} (×${concurrency}) ...`);
    const timings = [];
    const errors  = [];
    let completed = 0;

    const t0 = performance.now();

    while (completed < totalRequests) {
        const batch = Math.min(concurrency, totalRequests - completed);
        const promises = Array.from({ length: batch }, async () => {
            try {
                const ms = await fn();
                timings.push(ms);
            } catch (err) {
                errors.push(err.message);
            }
        });
        await Promise.all(promises);
        completed += batch;
    }

    const wallTime = performance.now() - t0;
    const rps = Math.round((timings.length / wallTime) * 1000);

    if (!timings.length) {
        console.log(` ❌ ${errors.length} erreurs`);
        results[name] = { error: true };
        return;
    }

    const s = stats(timings);
    results[name] = { ...s, rps, wallTime: Math.round(wallTime) };
    console.log(` avg=${s.avg}ms  p95=${s.p95}ms  ${rps} req/s  (${Math.round(wallTime)}ms total)`);
}

// ── Benchmarks ───────────────────────────────────────────────────────────────

async function run() {
    console.log(`\n📊  Benchmark — ${BASE}  (${ROUNDS} requêtes, concurrence ${CONCURRENCY})\n`);

    // Préchauffer
    await fetch(`${API}/activities`, { signal: AbortSignal.timeout(10000) }).catch(() => {});

    // --- Latence séquentielle (1 requête à la fois) ---
    console.log('── Latence séquentielle ────────────────────');

    await bench('GET / (racine)', async () => {
        const { ms } = await timedFetch(BASE);
        return ms;
    });

    await bench('GET /api/activities (liste)', async () => {
        const { ms } = await timedFetch(`${API}/activities`);
        return ms;
    });

    await bench('GET /api/activities/:id (détail)', async () => {
        const { ms } = await timedFetch(`${API}/activities/1`);
        return ms;
    });

    await bench('GET /api/activities?search=parc', async () => {
        const { ms } = await timedFetch(`${API}/activities?search=parc`);
        return ms;
    });

    await bench('GET /api/activities?lat=48.85&lng=2.35', async () => {
        const { ms } = await timedFetch(`${API}/activities?lat=48.8566&lng=2.3522`);
        return ms;
    });

    await bench('GET index.html (front)', async () => {
        const { ms } = await timedFetch(BASE);
        return ms;
    });

    await bench('GET main.css (static)', async () => {
        const { ms } = await timedFetch(`${BASE}/styles/main.css`);
        return ms;
    });

    await bench('POST /api/auth/login (test 490)', async () => {
        const { ms } = await timedFetch(`${API}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ testCode: '490' })
        });
        return ms;
    });

    // --- Débit concurrent ---
    console.log('\n── Débit concurrent ────────────────────────');

    await benchConcurrent('GET /api/activities (concurrent)', async () => {
        const { ms } = await timedFetch(`${API}/activities`);
        return ms;
    });

    await benchConcurrent('GET /api/activities/:id (concurrent)', async () => {
        const id = 1 + Math.floor(Math.random() * 10);
        const { ms } = await timedFetch(`${API}/activities/${id}`);
        return ms;
    });

    await benchConcurrent('GET index.html (concurrent)', async () => {
        const { ms } = await timedFetch(BASE);
        return ms;
    });

    await benchConcurrent('Mix API (concurrent)', async () => {
        const endpoints = [
            `${API}/activities`,
            `${API}/activities/1`,
            `${API}/activities?search=parc`,
            `${API}/activities?lat=48.85&lng=2.35`,
            `${BASE}/`,
        ];
        const url = endpoints[Math.floor(Math.random() * endpoints.length)];
        const { ms } = await timedFetch(url);
        return ms;
    });

    // ── Score global ─────────────────────────────────────────────────────────

    console.log('\n── Score global ────────────────────────────');

    const weights = {
        'GET /api/activities (liste)':             3,
        'GET /api/activities/:id (détail)':        2,
        'GET /api/activities?search=parc':          1,
        'GET /api/activities?lat=48.85&lng=2.35':  1,
        'POST /api/auth/login (test 490)':         1,
        'GET /api/activities (concurrent)':         3,
        'Mix API (concurrent)':                     2,
    };

    let weightedSum = 0;
    let totalWeight = 0;

    for (const [name, weight] of Object.entries(weights)) {
        const r = results[name];
        if (r && !r.error && r.avg) {
            weightedSum += r.avg * weight;
            totalWeight += weight;
        }
    }

    const avgWeighted = totalWeight ? Math.round(weightedSum / totalWeight) : 0;

    // Score logarithmique : 5ms→950, 50ms→667, 200ms→333, 500ms→167, 1000ms→91
    const score = Math.round(1000 / (1 + avgWeighted / 100));

    const rpsEntries = Object.values(results).filter(r => r.rps);
    const avgRps = rpsEntries.length
        ? Math.round(rpsEntries.reduce((s, r) => s + r.rps, 0) / rpsEntries.length)
        : 0;

    console.log(`\n  📈  Score de performance : ${score} / 1000`);
    console.log(`  📈  Latence moyenne pondérée : ${avgWeighted} ms`);
    console.log(`  📈  Débit moyen : ${avgRps} req/s`);

    // ── Sauvegarder l'historique ─────────────────────────────────────────────

    const fs   = require('fs');
    const path = require('path');
    const historyPath = path.join(__dirname, 'benchmark-history.json');

    let history = [];
    try {
        const raw = fs.readFileSync(historyPath, 'utf-8');
        history = JSON.parse(raw);
    } catch {}

    history.push({
        date:    new Date().toISOString(),
        base:    BASE,
        score,
        avgMs:   avgWeighted,
        avgRps,
        details: results
    });

    // Garder les 50 derniers
    if (history.length > 50) history = history.slice(-50);
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));

    console.log(`\n  💾  Résultat sauvegardé dans benchmark-history.json`);

    // Afficher l'évolution si on a au moins 2 entrées
    if (history.length >= 2) {
        const prev = history[history.length - 2];
        const diff = score - prev.score;
        const arrow = diff > 0 ? '📈 ↑' : diff < 0 ? '📉 ↓' : '→';
        console.log(`  ${arrow}  Évolution : ${prev.score} → ${score} (${diff >= 0 ? '+' : ''}${diff})`);
    }

    console.log('');
}

run().catch(err => {
    console.error('\n💥 Erreur fatale :', err.message);
    process.exit(2);
});
