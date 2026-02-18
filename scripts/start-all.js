#!/usr/bin/env node
/**
 * Démarre Nginx (reverse proxy) puis l'app (frontend + backend).
 * Linux : sudo systemctl start nginx
 * Windows : net start nginx (si Nginx est un service) ou rien
 * Puis : npm start
 */

const { spawn } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';

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
  console.log('🦋 Les Papillons - démarrage complet (Nginx + app)\n');

  if (isWindows) {
    try {
      await run('net', ['start', 'nginx']);
      console.log('✅ Nginx démarré (service Windows)\n');
    } catch {
      console.log('ℹ️  Nginx non démarré par ce script (pas un service ou déjà lancé). Démarrez-le manuellement si besoin.\n');
    }
  } else {
    try {
      await run('sudo', ['systemctl', 'start', 'nginx']);
      console.log('✅ Nginx démarré\n');
    } catch {
      console.log('ℹ️  Nginx non démarré (sudo refusé ou déjà actif). Lancez: sudo systemctl start nginx\n');
    }
  }

  console.log('🚀 Lancement de l\'app (frontend + backend)...\n');
  await run('npm', ['start']);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
