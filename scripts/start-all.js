#!/usr/bin/env node
/**
 * Une commande : configure Nginx (supprime default), démarre Nginx, puis lance frontend (8080) + backend (3000).
 * Nginx reste un simple proxy vers le serveur frontend existant (http-server), pas de changement de techno.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';
const setupScript = path.join(rootDir, 'reverse-proxy', 'setup-nginx.sh');

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      shell: isWindows,
      cwd: rootDir,
      ...opts
    });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Exit ${code}`))));
    child.on('error', reject);
  });
}

async function main() {
  console.log('🦋 Les Papillons - Nginx (proxy) + frontend + backend\n');

  if (isWindows) {
    try {
      await run('net', ['start', 'nginx']);
      console.log('✅ Nginx démarré\n');
    } catch {
      console.log('ℹ️  Nginx : démarrez-le manuellement si besoin.\n');
    }
    await run('npm', ['start']);
    return;
  }

  if (fs.existsSync(setupScript)) {
    try {
      console.log('1. Config Nginx (suppression site default)...');
      await run('sudo', ['bash', setupScript]);
      console.log('✅ Nginx OK\n');
    } catch {
      console.log('⚠️  Nginx : sudo bash reverse-proxy/setup-nginx.sh\n');
    }
  }

  console.log('2. Lancement frontend (8080) + backend (3000)...\n');
  await run('npm', ['start']);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
