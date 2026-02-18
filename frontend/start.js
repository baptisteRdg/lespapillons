/**
 * Script de Démarrage Frontend avec Gestion du Port
 * 
 * Ce script vérifie si le port 8080 est disponible et le libère si nécessaire
 * avant de démarrer http-server
 */

const { spawn } = require('child_process');
const net = require('net');

const PORT = 8080;

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
                resolve(true);
            }
        });
        
        server.once('listening', () => {
            server.close();
            resolve(true);
        });
        
        server.listen(port, '0.0.0.0');
    });
}

/**
 * Trouve et tue le processus utilisant un port donné
 */
async function killProcessOnPort(port) {
    return new Promise((resolve, reject) => {
        const platform = process.platform;
        
        if (platform === 'win32') {
            // Windows : utiliser netstat pour trouver le PID
            const netstat = spawn('netstat', ['-ano']);
            let output = '';
            
            netstat.stdout.on('data', (data) => {
                output += data.toString();
            });
            
            netstat.on('close', () => {
                const lines = output.split('\n');
                for (const line of lines) {
                    if (line.includes(`:${port}`) && line.includes('LISTENING')) {
                        const parts = line.trim().split(/\s+/);
                        const pid = parts[parts.length - 1];
                        
                        if (pid && !isNaN(pid)) {
                            console.log(`⚠️  Port ${port} occupé par le processus ${pid}`);
                            console.log('🔄 Arrêt du processus...');
                            
                            const taskkill = spawn('taskkill', ['/F', '/PID', pid]);
                            taskkill.on('close', (code) => {
                                if (code === 0) {
                                    console.log('✅ Processus arrêté');
                                    resolve();
                                } else {
                                    reject(new Error('Échec de l\'arrêt du processus'));
                                }
                            });
                            return;
                        }
                    }
                }
                resolve();
            });
        } else {
            // Unix/Linux/Mac : utiliser lsof
            const lsof = spawn('lsof', ['-ti', `:${port}`]);
            let pid = '';
            
            lsof.stdout.on('data', (data) => {
                pid += data.toString().trim();
            });
            
            lsof.on('close', () => {
                if (pid) {
                    console.log(`⚠️  Port ${port} occupé par le processus ${pid}`);
                    console.log('🔄 Arrêt du processus...');
                    
                    const kill = spawn('kill', ['-9', pid]);
                    kill.on('close', (code) => {
                        if (code === 0) {
                            console.log('✅ Processus arrêté');
                            resolve();
                        } else {
                            reject(new Error('Échec de l\'arrêt du processus'));
                        }
                    });
                } else {
                    resolve();
                }
            });
        }
    });
}

/**
 * Démarre http-server
 */
async function startServer() {
    console.log('\n🔍 Vérification du port 8080...\n');
    
    const available = await isPortAvailable(PORT);
    
    if (!available) {
        try {
            await killProcessOnPort(PORT);
            // Petite pause pour s'assurer que le port est libéré
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            console.error('❌ Impossible de libérer le port:', error.message);
            process.exit(1);
        }
    } else {
        console.log('✅ Port 8080 disponible\n');
    }
    
    console.log('🚀 Démarrage de http-server...\n');
    
    // Démarrer http-server
    const server = spawn('npx', ['http-server', '-p', '8080', '-c-1', '--proxy', 'http://localhost:8080?', '-o'], {
        stdio: 'inherit',
        shell: true
    });
    
    server.on('error', (error) => {
        console.error('❌ Erreur lors du démarrage:', error);
        process.exit(1);
    });
    
    server.on('close', (code) => {
        if (code !== 0) {
            console.error(`❌ Le serveur s'est arrêté avec le code ${code}`);
            process.exit(code);
        }
    });
}

// Démarrer
startServer().catch((error) => {
    console.error('❌ Erreur fatale:', error);
    process.exit(1);
});
