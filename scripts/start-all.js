#!/usr/bin/env node
/**
 * Une seule commande : configure Nginx (supprime le default, injecte le chemin frontend),
 * démarre Nginx, puis lance le backend. Nginx sert le frontend (fichiers statiques), plus de serveur sur 8080.
 * Linux : sudo setup-nginx.sh puis npm run start:backend
 * Windows : net start nginx (si service) puis npm start (frontend + backend, pas de config Nginx auto)
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
  console.log('🦋 Les Papillons - démarrage complet (Nginx + backend)\n');

  if (isWindows) {
    try {
      await run('net', ['start', 'nginx']);
      console.log('✅ Nginx démarré (service Windows)\n');
    } catch {
      console.log('ℹ️  Nginx non démarré par ce script. Démarrez-le manuellement si vous l’utilisez.\n');
    }
    console.log('🚀 Lancement frontend + backend...\n');
    await run('npm', ['start']);
    return;
  }

  // Linux : config Nginx (supprime default, injecte chemin) + start nginx, puis backend uniquement
  if (!fs.existsSync(setupScript)) {
    console.error('❌ Fichier manquant: reverse-proxy/setup-nginx.sh');
    process.exit(1);
  }
  try {
    console.log('1. Configuration Nginx (suppression site par défaut + chemin frontend)...');
    await run('sudo', ['bash', setupScript]);
    console.log('✅ Nginx configuré et démarré\n');
  } catch (e) {
    console.log('⚠️  Nginx non configuré/démarré (sudo ?). Lancez: sudo bash reverse-proxy/setup-nginx.sh\n');
  }

  console.log('2. Lancement du backend (port 3000). Le frontend est servi par Nginx sur le port 80.\n');
  await run('npm', ['run', 'start:backend']);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
