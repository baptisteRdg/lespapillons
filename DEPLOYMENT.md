# Déploiement

## Nouveau PC — setup complet

### 1. Installer les dépendances

```bash
# À la racine du projet
npm run install:all
```

Ça installe les dépendances de la racine, du frontend et du backend.

---

### 2. Créer le fichier `.env`

Le fichier `backend/.env` **n'est pas dans le git** (données sensibles). Il faut le créer à la main.

Créer le fichier `backend/.env`

> Les vraies valeurs sont sur Firebase Console ou dans le `.env` d'une machine qui fonctionne déjà.

---

### 3. Initialiser la base de données

```bash
cd backend
npx prisma generate    # génère le client Prisma (obligatoire après clonage)
npx prisma migrate deploy  # applique les migrations
```

Si tu veux des données de test :
```bash
npm run import         # importer les GeoJSON depuis data/geojson/
```

---

### 4. Lancer

```bash
# Depuis la racine du projet
npm start
```

- Frontend → `http://localhost:8080`
- Backend → `http://localhost:3000`

---

## Firebase — config requise une seule fois

Ces réglages sont sur [Firebase Console](https://console.firebase.google.com) → projet `beout-1d4a0`.

**Authentication → Sign-in method**
- Activer **Phone** (toggle bleu)

**Authentication → Settings → SMS region policy**
- Ajouter les régions voulues (France au minimum)

**Authentication → Settings → Authorized domains**
- Ajouter `beout.fr` (et `localhost` pour dev local si besoin)

**Authentication → Sign-in method → Phone numbers for testing** (optionnel)
- Numéro `+33490000490` / code `490490` → compte dev sans SMS réel

---

## Prod (serveur Linux)

```bash
# 1. Installer Nginx (une fois)
sudo apt update && sudo apt install nginx -y

# 2. À la racine du projet
npm run install:all

# 3. Créer backend/.env (voir section ci-dessus)
nano backend/.env

# 4. Base de données
cd backend
npx prisma generate
npx prisma migrate deploy
cd ..

# 5. Lancer tout (Nginx + frontend + backend)
npm run start:all
```

La première fois, `start:all` demande le mot de passe sudo pour configurer Nginx.

**Box/routeur** : rediriger le port 80 (et 443 pour HTTPS) vers l'IP du serveur.

---

## HTTPS

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d beout.fr
sudo ufw allow 443/tcp && sudo ufw reload
```

Renouvellement automatique. Ne pas relancer `setup-nginx.sh` après Certbot (ça écrase la config SSL). Pour relancer l'app : `npm run start:all` uniquement.

---

## Mise à jour (après un `git pull`)

```bash
cd backend
npm install              # si des dépendances ont changé
npx prisma generate      # si le schéma a changé
npx prisma migrate deploy
cd ..
npm run start:all
```

---

## Problèmes courants

**`Cannot find module 'dotenv'` ou autre module manquant**
→ `cd backend && npm install`

**`Cannot read properties of undefined` sur un clic de fiche**
→ Prisma client pas généré : `cd backend && npx prisma generate`

**Firebase Admin non initialisé**
→ Le `.env` est incomplet ou manquant. Vérifier que les 3 variables `FIREBASE_PROJECT_ID`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL` sont présentes.

**`auth/operation-not-allowed`**
→ Phone Auth pas activé sur Firebase Console, ou la région France pas autorisée (voir section Firebase ci-dessus).

**Header caché / page décalée après connexion**
→ Actualiser la page. Si c'est systématique, vérifier que le script `start:all` a bien redémarré.

**Port déjà utilisé (EADDRINUSE)**
```bash
# Linux
lsof -ti:3000 | xargs kill -9
lsof -ti:8080 | xargs kill -9
```

**Nginx affiche "Welcome to nginx"**
→ `sudo bash reverse-proxy/setup-nginx.sh`

**Backup base de données**
```bash
cp backend/prisma/dev.db backend/prisma/dev.db.backup
```
