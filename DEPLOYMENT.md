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

---

## HTTPS (Let's Encrypt)

Aucun site ni service tiers : le certificat est obtenu par un outil sur ton serveur qui parle directement à Let's Encrypt.

**Avec Nginx déjà en place** (reverse proxy sur le port 80) :

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d beout.fr
```

Certbot configure le SSL et la redirection HTTP → HTTPS. Renouvellement auto (à laisser par défaut). Ouvrir le port **443** sur la box en plus du 80.

**Redémarrage** : pas besoin de refaire Certbot à chaque fois. Le script `setup-nginx.sh` a été modifié : si la config contient déjà le SSL, il ne l’écrase plus. Tu peux relancer `npm run start:all` sans perdre le HTTPS. (Ancien comportement : ne **pas** relancer `setup-nginx.sh` ni `npm run start:all` pour « refaire la config Nginx » : le script recopie notre `nginx.conf` (sans SSL) et **écrase** le bloc HTTPS ajouté par Certbot. Si tu l’as fait, relancer simplement : `sudo certbot --nginx -d beout.fr`.

**Si HTTPS ne répond pas** : pas d’attente, ça doit marcher tout de suite. Vérifier :
1. **URL** : utiliser **https://beout.fr** (pas l’IP), le certificat est pour le nom de domaine.
2. **Port 443** : sur la box/routeur, rediriger le port **443** (externe) vers l’IP du serveur, port **443**.
3. **Nginx** : `sudo nginx -t && sudo systemctl reload nginx`. Vérifier que Nginx tourne : `sudo systemctl status nginx`.
4. Relancer le serveur = relancer **l’app** (`npm run start:all`) ; Nginx est un service à part, il reste actif avec le SSL. Si tu as redémarré la machine, Nginx repart tout seul.

**En plus (souvent le vrai blocage)** : pare-feu **sur le serveur** (ufw). Le 80 peut être ouvert mais pas le 443. Sur le serveur : `sudo ufw status` ; si 443 n'est pas listé en ALLOW : `sudo ufw allow 443/tcp` puis `sudo ufw reload`. Vérifier que Nginx écoute sur 443 : `sudo nginx -T | grep "listen 443"` (doit afficher une ligne avec ssl). Test local : `curl -I https://127.0.0.1 -k` (si ça répond, le blocage est ufw ou box).