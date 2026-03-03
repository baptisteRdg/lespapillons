#!/usr/bin/env node
/**
 * Lance les tests de santé + benchmark en séquence.
 *
 * Usage :  node tests/run.js [BASE_URL]
 * Défaut : http://localhost:3000
 */

const { execSync } = require('child_process');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:3000';
const dir  = __dirname;

console.log('╔══════════════════════════════════════════════╗');
console.log('║    🦋  BeOut — Tests & Benchmark             ║');
console.log('╚══════════════════════════════════════════════╝\n');

let healthOk = true;

try {
    console.log('━━━━━━ Phase 1 : Tests de santé ━━━━━━━━━━━━━\n');
    execSync(`node "${path.join(dir, 'health.js')}" "${BASE}"`, { stdio: 'inherit' });
} catch {
    healthOk = false;
    console.log('\n⚠️  Des tests de santé ont échoué. Le benchmark va quand même tourner.\n');
}

try {
    console.log('\n━━━━━━ Phase 2 : Benchmark ━━━━━━━━━━━━━━━━━━\n');
    execSync(`node "${path.join(dir, 'benchmark.js')}" "${BASE}"`, { stdio: 'inherit' });
} catch (err) {
    console.error('\n❌ Le benchmark a échoué :', err.message);
    process.exit(2);
}

if (!healthOk) {
    console.log('⚠️  Rappel : certains tests de santé ont échoué.');
    process.exit(1);
}
