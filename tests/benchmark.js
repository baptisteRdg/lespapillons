#!/usr/bin/env node
/**
 * Test de charge — simule des utilisateurs réels pour mesurer
 * la capacité du serveur sous pression.
 *
 * Phases :
 *   1. Préchauffage
 *   2. Parcours utilisateur seul  (latence de référence)
 *   3. Montée en charge           (1 → 30 utilisateurs simultanés)
 *   4. Rafale                     (50 requêtes simultanées)
 *   5. Endurance                  (charge soutenue 15 s)
 *   6. Score détaillé + explication du calcul
 *
 * Usage :  node tests/benchmark.js [BASE_URL]
 * Défaut : http://localhost:3000
 */

const BASE = process.argv[2] || 'http://localhost:3000';
const API  = `${BASE}/api`;

const SOLO_ROUNDS          = 10;
const RAMP_LEVELS          = [1, 5, 10, 20, 30];
const SPIKE_REQUESTS       = 50;
const ENDURANCE_MS         = 15_000;
const ENDURANCE_USERS      = 10;
const ENDURANCE_WINDOW_MS  = 5_000;
const TIMEOUT_MS           = 15_000;

// ── Helpers ──────────────────────────────────────────────────────────

async function timedFetch(url, opts = {}) {
    const t0 = performance.now();
    try {
        const res  = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), ...opts });
        const body = await res.text();
        return { ms: performance.now() - t0, ok: res.ok, status: res.status, body };
    } catch (err) {
        return { ms: performance.now() - t0, ok: false, status: 0, error: err.message };
    }
}

function computeStats(timings) {
    if (!timings.length) return { count: 0, avg: 0, p50: 0, p95: 0, min: 0, max: 0, stddev: 0 };
    const sorted = [...timings].sort((a, b) => a - b);
    const n   = sorted.length;
    const sum = sorted.reduce((s, v) => s + v, 0);
    const avg = sum / n;
    const variance = sorted.reduce((s, v) => s + (v - avg) ** 2, 0) / n;
    return {
        count:  n,
        avg:    Math.round(avg),
        p50:    Math.round(sorted[Math.floor(n * 0.5)]),
        p95:    Math.round(sorted[Math.ceil(n * 0.95) - 1]),
        min:    Math.round(sorted[0]),
        max:    Math.round(sorted[n - 1]),
        stddev: Math.round(Math.sqrt(variance)),
    };
}

function lerp(value, thresholds) {
    if (value <= thresholds[0][0]) return thresholds[0][1];
    const last = thresholds[thresholds.length - 1];
    if (value >= last[0]) return last[1];
    for (let i = 0; i < thresholds.length - 1; i++) {
        const [v1, s1] = thresholds[i];
        const [v2, s2] = thresholds[i + 1];
        if (value <= v2) return Math.round(s1 + ((value - v1) / (v2 - v1)) * (s2 - s1));
    }
    return last[1];
}

function pad(v, n)  { return String(v).padStart(n); }
function padR(v, n) { return String(v).padEnd(n); }

// ── Parcours utilisateur ────────────────────────────────────────────

async function fullUserFlow(activityIds, token) {
    const pick = () => activityIds[Math.floor(Math.random() * activityIds.length)];
    const steps = [
        { label: 'Charger la page',   fn: () => timedFetch(BASE) },
        { label: 'Charger le CSS',    fn: () => timedFetch(`${BASE}/styles/main.css`) },
        { label: 'Lister activités',  fn: () => timedFetch(`${API}/activities`) },
        { label: 'Voir une activité', fn: () => timedFetch(`${API}/activities/${pick()}`) },
        { label: 'Rechercher',        fn: () => timedFetch(`${API}/activities?search=parc`) },
        { label: 'Voir un résultat',  fn: () => timedFetch(`${API}/activities/${pick()}`) },
        { label: 'Se connecter',      fn: () => timedFetch(`${API}/auth/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ testCode: '490' })
        })},
        { label: 'Voir son profil',   fn: () => timedFetch(`${API}/users/me`, {
            headers: { Authorization: `Bearer ${token}` }
        })},
    ];

    const results = [];
    for (const { label, fn } of steps) {
        const r = await fn();
        results.push({ label, ms: r.ms, ok: r.ok });
    }
    return results;
}

async function shortUserFlow(activityIds) {
    const id = activityIds[Math.floor(Math.random() * activityIds.length)];
    const steps = [
        () => timedFetch(BASE),
        () => timedFetch(`${API}/activities`),
        () => timedFetch(`${API}/activities/${id}`),
        () => timedFetch(`${API}/activities?search=parc`),
    ];

    const results = [];
    for (const fn of steps) {
        const r = await fn();
        results.push({ ms: r.ms, ok: r.ok });
    }
    return results;
}

// ── Main ────────────────────────────────────────────────────────────

async function run() {
    console.log(`\n📊  Test de charge — ${BASE}`);
    console.log('    Simulation d\'utilisateurs réels pour mesurer la capacité\n');

    let totalRequests = 0;
    let totalErrors   = 0;

    // ═══════════════════════════════════════════════════════════════════
    //  Phase 1 : Préchauffage
    // ═══════════════════════════════════════════════════════════════════

    console.log('── Phase 1 : Préchauffage ──────────────────────');
    process.stdout.write('  Préchauffage du serveur');
    for (let i = 0; i < 5; i++) {
        await timedFetch(`${API}/activities`);
        await timedFetch(`${API}/activities/1`);
        process.stdout.write('.');
    }

    const listRes = await timedFetch(`${API}/activities`);
    let activityIds = [1, 2, 3, 4, 5];
    try {
        const data = JSON.parse(listRes.body);
        const arr = Array.isArray(data) ? data : (data.data || data.activities || []);
        if (arr.length && arr[0].id) activityIds = arr.map(a => a.id).slice(0, 20);
    } catch {}

    const loginRes = await timedFetch(`${API}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testCode: '490' })
    });
    let token = '';
    try { token = JSON.parse(loginRes.body).token || ''; } catch {}

    console.log(' OK\n');

    // ═══════════════════════════════════════════════════════════════════
    //  Phase 2 : Parcours utilisateur seul
    // ═══════════════════════════════════════════════════════════════════

    console.log('── Phase 2 : Utilisateur seul ──────────────────');
    console.log(`  ${SOLO_ROUNDS} parcours complets (8 étapes chacun)\n`);

    const stepAgg = {};
    const flowTotals = [];

    for (let i = 0; i < SOLO_ROUNDS; i++) {
        const results = await fullUserFlow(activityIds, token);
        let total = 0;
        for (const r of results) {
            (stepAgg[r.label] ??= []).push(r.ms);
            total += r.ms;
            totalRequests++;
            if (!r.ok) totalErrors++;
        }
        flowTotals.push(total);
    }

    for (const [label, t] of Object.entries(stepAgg)) {
        const s = computeStats(t);
        console.log(`    ${padR(label, 20)} avg=${pad(s.avg, 5)}ms  p95=${pad(s.p95, 5)}ms`);
    }

    const baselineAll   = Object.values(stepAgg).flat();
    const baselineStats = computeStats(baselineAll);
    const flowStats     = computeStats(flowTotals);

    console.log('');
    console.log(`  Session complète   avg=${pad(flowStats.avg, 5)}ms  p95=${pad(flowStats.p95, 5)}ms`);
    console.log(`  Par requête        avg=${pad(baselineStats.avg, 5)}ms  p95=${pad(baselineStats.p95, 5)}ms\n`);

    // ═══════════════════════════════════════════════════════════════════
    //  Phase 3 : Montée en charge
    // ═══════════════════════════════════════════════════════════════════

    console.log('── Phase 3 : Montée en charge ──────────────────');
    console.log('  Chaque utilisateur effectue un parcours de 4 requêtes\n');

    const rampData = [];
    let rampBaselineAvg = null;

    for (const n of RAMP_LEVELS) {
        const icon = n === 1 ? '👤' : '👥';
        process.stdout.write(`  ${icon}  ×${pad(n, 2)} `);

        const t0  = performance.now();
        const all = await Promise.all(Array.from({ length: n }, () => shortUserFlow(activityIds)));
        const wall = performance.now() - t0;

        const timings = []; let errors = 0; const flows = [];
        for (const userRes of all) {
            let ft = 0;
            for (const r of userRes) {
                timings.push(r.ms); ft += r.ms;
                totalRequests++;
                if (!r.ok) { totalErrors++; errors++; }
            }
            flows.push(ft);
        }

        const s   = computeStats(timings);
        const fs  = computeStats(flows);
        const rps = Math.round((timings.length / wall) * 1000);

        if (rampBaselineAvg === null) rampBaselineAvg = s.avg;
        const ratio = rampBaselineAvg > 0 ? s.avg / rampBaselineAvg : 1;
        rampData.push({ n, avg: s.avg, p95: s.p95, errors, ratio, rps, flowAvg: fs.avg });

        const deg = n === 1 ? '' : `  (×${ratio.toFixed(1)})`;
        console.log(
            `session=${pad(fs.avg, 6)}ms  req=${pad(s.avg, 5)}ms  p95=${pad(s.p95, 5)}ms  ` +
            `${pad(rps, 4)} req/s  err=${errors}${deg}`
        );
    }

    const r1  = rampData.find(r => r.n === 1);
    const r20 = rampData.find(r => r.n === 20) || rampData[rampData.length - 1];
    const degradationRatio = (r1 && r20 && r1.avg > 0) ? r20.avg / r1.avg : 10;

    console.log('');

    // ═══════════════════════════════════════════════════════════════════
    //  Phase 4 : Rafale (spike)
    // ═══════════════════════════════════════════════════════════════════

    console.log('── Phase 4 : Rafale ────────────────────────────');
    console.log(`  ${SPIKE_REQUESTS} requêtes simultanées sur /api/activities\n`);

    const spikeT0  = performance.now();
    const spikeAll = await Promise.all(
        Array.from({ length: SPIKE_REQUESTS }, () => timedFetch(`${API}/activities`))
    );
    const spikeWall = performance.now() - spikeT0;

    let spikeErrors = 0;
    const spikeTimings = spikeAll.map(r => {
        totalRequests++;
        if (!r.ok) { totalErrors++; spikeErrors++; }
        return r.ms;
    });

    const ss = computeStats(spikeTimings);
    console.log(`  Temps moyen     : ${pad(ss.avg, 5)} ms`);
    console.log(`  p95             : ${pad(ss.p95, 5)} ms`);
    console.log(`  Max             : ${pad(ss.max, 5)} ms`);
    console.log(`  Erreurs         : ${spikeErrors}/${SPIKE_REQUESTS}`);
    console.log(`  Débit           : ${Math.round((SPIKE_REQUESTS / spikeWall) * 1000)} req/s\n`);

    // ═══════════════════════════════════════════════════════════════════
    //  Phase 5 : Endurance
    // ═══════════════════════════════════════════════════════════════════

    console.log('── Phase 5 : Endurance ─────────────────────────');
    console.log(`  ${ENDURANCE_USERS} utilisateurs en continu pendant ${ENDURANCE_MS / 1000}s\n`);

    const endStart  = performance.now();
    const endFinish = endStart + ENDURANCE_MS;
    const entries   = [];

    const endWorker = async () => {
        while (performance.now() < endFinish) {
            const id = activityIds[Math.floor(Math.random() * activityIds.length)];
            const steps = [
                () => timedFetch(BASE),
                () => timedFetch(`${API}/activities`),
                () => timedFetch(`${API}/activities/${id}`),
                () => timedFetch(`${API}/activities?search=parc`),
            ];
            for (const fn of steps) {
                if (performance.now() >= endFinish) break;
                const r = await fn();
                entries.push({ ms: r.ms, ok: r.ok, t: performance.now() - endStart });
            }
        }
    };

    await Promise.all(Array.from({ length: ENDURANCE_USERS }, endWorker));
    const endWall = performance.now() - endStart;

    for (const e of entries) { totalRequests++; if (!e.ok) totalErrors++; }

    const windowCount = Math.ceil(endWall / ENDURANCE_WINDOW_MS);
    for (let w = 0; w < windowCount; w++) {
        const lo = w * ENDURANCE_WINDOW_MS;
        const hi = (w + 1) * ENDURANCE_WINDOW_MS;
        const wEntries = entries.filter(e => e.t >= lo && e.t < hi);
        if (!wEntries.length) continue;
        const wStats = computeStats(wEntries.map(e => e.ms));
        const wErr   = wEntries.filter(e => !e.ok).length;
        const wRps   = Math.round(wEntries.length / (ENDURANCE_WINDOW_MS / 1000));
        const label  = `${Math.round(lo / 1000)}-${Math.round(hi / 1000)}s`;
        console.log(
            `  ${padR(label, 6)}  avg=${pad(wStats.avg, 5)}ms  ` +
            `p95=${pad(wStats.p95, 5)}ms  ${pad(wRps, 4)} req/s  err=${wErr}`
        );
    }

    const endAllMs     = entries.map(e => e.ms);
    const endStats     = computeStats(endAllMs);
    const sustainedRps = Math.round((entries.length / endWall) * 1000);
    const cv           = endStats.avg > 0 ? endStats.stddev / endStats.avg : 2;
    const endErrors    = entries.filter(e => !e.ok).length;

    console.log('');
    console.log(`  Total requêtes    : ${entries.length}`);
    console.log(`  Débit soutenu     : ${sustainedRps} req/s`);
    console.log(`  Coeff. variation  : ${cv.toFixed(2)}`);
    console.log(`  Erreurs           : ${endErrors}\n`);

    // ═══════════════════════════════════════════════════════════════════
    //  Phase 6 : Score
    // ═══════════════════════════════════════════════════════════════════

    const successRate = totalRequests > 0 ? (totalRequests - totalErrors) / totalRequests : 0;

    const scoreLatency    = lerp(baselineStats.avg, [[30, 200], [100, 160], [300, 100], [800, 40], [2000, 0]]);
    const scoreRamp       = lerp(degradationRatio,  [[1, 300],  [2, 240],  [5, 120],   [10, 40],  [20, 0]]);
    const scoreThroughput = lerp(sustainedRps,      [[5, 0],    [10, 50],  [20, 100],  [50, 150], [100, 200]]);
    const scoreReliability= lerp(successRate,       [[0.9, 0],  [0.95, 100], [1.0, 200]]);
    const scoreStability  = lerp(cv,                [[0.1, 100],[0.3, 70],  [0.5, 40],  [1.0, 10], [2.0, 0]]);

    const total = scoreLatency + scoreRamp + scoreThroughput + scoreReliability + scoreStability;

    console.log('══════════════════════════════════════════════════');
    console.log(`   SCORE DE CHARGE : ${total} / 1000`);
    console.log('══════════════════════════════════════════════════\n');

    console.log('  ┌──────────────────────────┬────────┬───────┐');
    console.log('  │ Catégorie                │ Points │  /Max │');
    console.log('  ├──────────────────────────┼────────┼───────┤');
    console.log(`  │ Latence de base          │ ${pad(scoreLatency, 6)} │  /200 │`);
    console.log(`  │ Montée en charge         │ ${pad(scoreRamp, 6)} │  /300 │`);
    console.log(`  │ Débit soutenu            │ ${pad(scoreThroughput, 6)} │  /200 │`);
    console.log(`  │ Fiabilité                │ ${pad(scoreReliability, 6)} │  /200 │`);
    console.log(`  │ Stabilité                │ ${pad(scoreStability, 6)} │  /100 │`);
    console.log('  └──────────────────────────┴────────┴───────┘\n');

    console.log('  Méthode de calcul :\n');

    console.log('  • Latence de base (max 200 pts)');
    console.log(`    Temps moyen par requête, utilisateur seul : ${baselineStats.avg} ms`);
    console.log('    Barème : ≤30ms→200  100ms→160  300ms→100  800ms→40  ≥2000ms→0');
    console.log(`    → ${scoreLatency} pts\n`);

    console.log('  • Montée en charge (max 300 pts)');
    console.log(`    Ratio de dégradation 1→${r20.n} utilisateurs : ×${degradationRatio.toFixed(1)}`);
    console.log('    Barème : ×1→300  ×2→240  ×5→120  ×10→40  ≥×20→0');
    console.log(`    → ${scoreRamp} pts\n`);

    console.log('  • Débit soutenu (max 200 pts)');
    console.log(`    Requêtes/s pendant l'endurance (${ENDURANCE_USERS} users, ${ENDURANCE_MS / 1000}s) : ${sustainedRps} req/s`);
    console.log('    Barème : ≤5→0  10→50  20→100  50→150  ≥100→200');
    console.log(`    → ${scoreThroughput} pts\n`);

    console.log('  • Fiabilité (max 200 pts)');
    console.log(`    Taux de succès : ${(successRate * 100).toFixed(1)}% (${totalRequests - totalErrors}/${totalRequests})`);
    console.log('    Barème : ≤90%→0  95%→100  100%→200');
    console.log(`    → ${scoreReliability} pts\n`);

    console.log('  • Stabilité (max 100 pts)');
    console.log(`    Coefficient de variation pendant l'endurance : ${cv.toFixed(2)}`);
    console.log('    (écart-type ÷ moyenne — plus c\'est bas, plus c\'est régulier)');
    console.log('    Barème : ≤0.1→100  0.3→70  0.5→40  1.0→10  ≥2.0→0');
    console.log(`    → ${scoreStability} pts\n`);

    // ── Sauvegarde ──────────────────────────────────────────────────

    const fs   = require('fs');
    const path = require('path');
    const historyPath = path.join(__dirname, 'benchmark-history.json');

    let history = [];
    try { history = JSON.parse(fs.readFileSync(historyPath, 'utf-8')); } catch {}

    history.push({
        date:      new Date().toISOString(),
        base:      BASE,
        score:     total,
        breakdown: { scoreLatency, scoreRamp, scoreThroughput, scoreReliability, scoreStability },
        raw: {
            baselineAvgMs:    baselineStats.avg,
            degradationRatio: +degradationRatio.toFixed(2),
            sustainedRps,
            successRate:      +(successRate * 100).toFixed(1),
            cv:               +cv.toFixed(2),
            totalRequests,
            totalErrors,
        },
    });

    if (history.length > 50) history = history.slice(-50);
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));

    console.log('  💾 Sauvegardé dans benchmark-history.json');

    if (history.length >= 2) {
        const prev = history[history.length - 2];
        const diff = total - prev.score;
        const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
        console.log(`  ${arrow}  Évolution : ${prev.score} → ${total} (${diff >= 0 ? '+' : ''}${diff})`);
    }

    console.log('');
}

run().catch(err => {
    console.error('\n💥 Erreur fatale :', err.message);
    process.exit(2);
});