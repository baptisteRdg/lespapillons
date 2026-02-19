# Reverse proxy

**Production (Linux)** : `npm run start:all` depuis la racine. Configure Nginx (supprime le site default), démarre Nginx, lance le backend. Nginx sert les fichiers du dossier `frontend/` et proxy `/api` vers le backend. Port 80 uniquement sur la box.

**Dev local** : `npm start` (frontend 8080 + backend 3000). Prérequis : `sudo apt install nginx -y` avant le premier `start:all`.
