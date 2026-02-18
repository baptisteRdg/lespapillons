# 🚀 Déploiement de Les Papillons

## ✅ Ce qui fonctionne déjà (Cross-platform)

Le code JavaScript détecte automatiquement l'environnement :
- **Développement** : `http://localhost:3000/api`
- **Production** : `http://votre-serveur:3000/api`

Ouvrez la console du navigateur (F12), vous verrez : `🌐 API URL: ...`

---

## 🖥️ Démarrer les serveurs (Simple)

### Développement Local (Windows & Linux)

```bash
# Dans le dossier racine
npm start
```

Cela lance automatiquement :
- Frontend sur `http://localhost:8080`
- Backend sur `http://localhost:3000`

### Production sur Serveur

**1. Backend**
```bash
cd backend
npm start
```

**2. Frontend** 

Option A - Serveur HTTP simple :
```bash
cd frontend
npx http-server -p 8080
```

Option B - Via Nginx/Apache (voir plus bas)

---

## 🔓 Ouvrir les ports (Firewall)

### Linux (UFW)
```bash
sudo ufw allow 3000
sudo ufw allow 8080
```

### Linux (Firewalld - CentOS/RHEL)
```bash
sudo firewall-cmd --add-port=3000/tcp --permanent
sudo firewall-cmd --add-port=8080/tcp --permanent
sudo firewall-cmd --reload
```

### Windows Firewall
```powershell
# PowerShell en administrateur
New-NetFirewallRule -DisplayName "Backend Port 3000" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "Frontend Port 8080" -Direction Inbound -LocalPort 8080 -Protocol TCP -Action Allow
```

Ou via l'interface graphique : Panneau de configuration → Pare-feu Windows → Règles de trafic entrant

---

## 📦 Garder les serveurs actifs

### Option 1 : PM2 (Linux & Windows)

```bash
# Installation
npm install -g pm2

# Démarrer
cd backend
pm2 start start.js --name backend

cd ../frontend  
pm2 start "npx http-server -p 8080" --name frontend

# Sauvegarder
pm2 save
pm2 startup  # Linux seulement
```

### Option 2 : Écran/Tmux (Linux seulement)

```bash
# Terminal 1
screen -S backend
cd backend && npm start

# Terminal 2  
screen -S frontend
cd frontend && npx http-server -p 8080
```

### Option 3 : Service Windows (Windows seulement)

Utilisez NSSM (Non-Sucking Service Manager) ou PM2 (recommandé)

---

## 🌐 Configuration pour Production

### Vérifier que le backend écoute sur toutes les interfaces

Dans `backend/app.js`, à la fin du fichier :

```javascript
app.listen(PORT, () => {
    // ...
});
```

C'est bon ! Par défaut, Express écoute sur `0.0.0.0` (toutes les interfaces).

### Si vous utilisez Nginx (Optionnel)

```nginx
server {
    listen 80;
    server_name votre-domaine.com;
    
    # Frontend
    location / {
        root /chemin/vers/frontend;
        try_files $uri $uri/ /index.html;
    }
    
    # Backend API
    location /api {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Si vous utilisez Nginx, modifiez `frontend/scripts/api.js` ligne 24 :
```javascript
return '/api';  // Au lieu de construire l'URL avec :3000
```

---

## 🧪 Vérifier que ça fonctionne

### 1. Depuis le serveur lui-même

```bash
# Tester le backend
curl http://localhost:3000/api/activities

# Ou ouvrir dans le navigateur
http://localhost:3000/api-docs
```

### 2. Depuis l'extérieur

```bash
# Remplacer PAR_VOTRE_IP par l'IP de votre serveur
curl http://VOTRE_IP:3000/api/activities
```

Ou ouvrir dans le navigateur :
- Frontend : `http://VOTRE_IP:8080`
- Swagger : `http://VOTRE_IP:3000/api-docs`

### 3. Vérifier la console du navigateur

Ouvrez F12 et cherchez :
```
🌐 API URL: http://VOTRE_IP:3000/api
```

---

## 📊 Base de Données

### Localisation

Le fichier SQLite se trouve dans : `backend/prisma/dev.db`

### Importer des données

```bash
# Placer vos fichiers .geojson dans data/geojson/
# Puis :
npm run import
```

### Backup (Important !)

```bash
# Linux/Mac
cp backend/prisma/dev.db backend/prisma/dev.db.backup

# Windows
copy backend\prisma\dev.db backend\prisma\dev.db.backup
```

---

## ⚠️ Problèmes courants

### "Failed to fetch" dans la console

**Problème** : Le frontend ne peut pas contacter le backend

**Solutions** :
1. Vérifier que le backend est démarré : `http://VOTRE_IP:3000/api-docs`
2. Vérifier que le port 3000 est ouvert dans le firewall
3. Regarder dans la console : `🌐 API URL: ...`

### Erreur EADDRINUSE (port déjà utilisé)

**Solution** : Le script backend tue automatiquement l'ancien processus.  
Si ça persiste :

Linux/Mac :
```bash
lsof -ti:3000 | xargs kill -9
```

Windows :
```powershell
Get-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess | Stop-Process -Force
```

### Pas de données dans Swagger

**Problème** : Base de données vide

**Solution** :
```bash
cd backend
npm run db:seed    # Données de test
# ou
npm run import     # Importer vos GeoJSON
```

---

## 📝 Checklist de déploiement

- [ ] Backend démarré : `npm start` dans `backend/`
- [ ] Frontend démarré : `npx http-server -p 8080` dans `frontend/`
- [ ] Ports 3000 et 8080 ouverts dans le firewall
- [ ] Base de données existe : `backend/prisma/dev.db`
- [ ] Données importées : `npm run import`
- [ ] Swagger accessible : `http://VOTRE_IP:3000/api-docs`
- [ ] Frontend accessible : `http://VOTRE_IP:8080`
- [ ] Console navigateur : pas d'erreurs, log `🌐 API URL` correct

---

## 🎯 Configuration recommandée

**Pour un déploiement simple et fiable** :

1. **Installer Node.js** (si pas déjà fait)
2. **Cloner/copier le projet** sur le serveur
3. **Installer les dépendances** : `npm run install:all`
4. **Importer les données** : `npm run import`
5. **Ouvrir les ports** : 3000 et 8080
6. **Démarrer avec PM2** (fonctionne sur Windows ET Linux) :
   ```bash
   npm install -g pm2
   cd backend && pm2 start start.js --name backend
   cd ../frontend && pm2 start "npx http-server -p 8080" --name frontend
   pm2 save
   ```

C'est tout ! 🚀

---

## 🆘 Besoin d'aide ?

1. **Logs backend** : `pm2 logs backend` (si PM2) ou regarder le terminal
2. **Console navigateur** : F12 → Console (chercher les erreurs)
3. **Network requests** : F12 → Network (voir les requêtes API)
4. **Tester Swagger** : `http://VOTRE_IP:3000/api-docs`

