# Reverse proxy

Nginx = **proxy uniquement** (pas de service de fichiers). Le frontend reste **http-server** (8080), le backend Express (3000). Un seul port public : 80.

**Prod (Linux)** : `npm run start:all` → config Nginx + `npm start` (frontend + backend). Prérequis : `sudo apt install nginx -y`.
