/**
 * Script de démarrage du serveur avec gestion du port occupé
 */

const { spawn } = require('child_process');
const net = require('net');

const PORT = process.env.PORT || 3000;

/**
 * Vérifie si un port est disponible
 */
function isPortAvailable(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        
        server.once('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                resolve(false);
            } else {
                resolve(false);
            }
        });
        
        server.once('listening', () => {
            server.close();
            resolve(true);
        });
        
        server.listen(port);
    });
}

/**
 * Tue le processus qui utilise le port
 */
async function killProcessOnPort(port) {
    return new Promise((resolve) => {
        if (process.platform === 'win32') {
            // Windows
            const netstat = spawn('netstat', ['-ano']);
            let output = '';
            
            netstat.stdout.on('data', (data) => {
                output += data.toString();
            });
            
            netstat.on('close', () => {
                const lines = output.split('\n');
                const portLine = lines.find(line => line.includes(`:${port}`) && line.includes('LISTENING'));
                
                if (portLine) {
                    const parts = portLine.trim().split(/\s+/);
                    const pid = parts[parts.length - 1];
                    
                    if (pid && !isNaN(pid)) {
                        console.log(`⚠️  Port ${port} occupé par le processus ${pid}`);
                        console.log(`🔄 Arrêt du processus...`);
                        
                        const kill = spawn('taskkill', ['/F', '/PID', pid]);
                        kill.on('close', () => {
                            console.log(`✅ Processus arrêté`);
                            setTimeout(resolve, 1000);
                        });
                    } else {
                        resolve();
                    }
                } else {
                    resolve();
                }
            });
        } else {
            // Unix/Linux/Mac
            const lsof = spawn('lsof', ['-ti', `:${port}`]);
            let pid = '';
            
            lsof.stdout.on('data', (data) => {
                pid += data.toString().trim();
            });
            
            lsof.on('close', () => {
                if (pid) {
                    console.log(`⚠️  Port ${port} occupé par le processus ${pid}`);
                    console.log(`🔄 Arrêt du processus...`);
                    spawn('kill', ['-9', pid]).on('close', () => {
                        console.log(`✅ Processus arrêté`);
                        setTimeout(resolve, 1000);
                    });
                } else {
                    resolve();
                }
            });
        }
    });
}

/**
 * Démarre le serveur
 */
async function startServer() {
    console.log(`\n🔍 Vérification du port ${PORT}...\n`);
    
    const available = await isPortAvailable(PORT);
    
    if (!available) {
        await killProcessOnPort(PORT);
    } else {
        console.log(`✅ Port ${PORT} disponible\n`);
    }
    
    // Démarrer l'application
    console.log(`🚀 Démarrage du serveur...\n`);
    require('./app.js');
}

startServer().catch(console.error);
