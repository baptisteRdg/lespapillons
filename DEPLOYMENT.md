# Déploiement


## Démarrer les serveurs (Simple)

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

## Vérifications

Ouverture des ports :
- 3000
- 8080

---


## Tests de fonctionnement

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



## Base de Données

### Localisation

Le fichier SQLite se trouve dans : `backend/prisma/dev.db`

### Importer des données

```bash
# Placer vos fichiers .geojson dans data/geojson/
# Puis :
npm run import
```

### Backup

```bash
# Linux/Mac
cp backend/prisma/dev.db backend/prisma/dev.db.backup

# Windows
copy backend\prisma\dev.db backend\prisma\dev.db.backup
```

---

## Problèmes courants

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