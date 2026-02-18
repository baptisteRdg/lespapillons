# Reverse proxy Les Papillons

Un seul port exposé (80) pour le public. Nginx répartit le trafic vers le frontend et l’API.

## Box / réseau (redirection de port)

**À ouvrir sur la box (routeur) : uniquement le port 80.**

- Redirection : **Port externe 80** → **IP de ta machine** → **Port 80** (Nginx).
- Ne pas ouvrir les ports 8080 ni 3000 : ils ne servent qu’en local sur la machine (Nginx s’y connecte en 127.0.0.1).

## Comportement

- **Port 80** (public) → Nginx
  - `/` → frontend (http://127.0.0.1:8080)
  - `/api` → backend (http://127.0.0.1:3000)
  - `/api-docs` → Swagger (http://127.0.0.1:3000)

En local, le frontend reste sur 8080 et le backend sur 3000 ; seul Nginx écoute sur 80.

## Installation (Linux)

**Méthode simple (recommandée) – une seule commande :**

```bash
# Depuis la racine du projet (après avoir installé Nginx : sudo apt install nginx -y)
sudo bash reverse-proxy/setup-nginx.sh
```

Le script copie la config, active le site **et supprime le site par défaut** (sinon tu restes sur "Welcome to nginx").

---

**Méthode manuelle :**

1. Installer Nginx : `sudo apt update && sudo apt install nginx -y`
2. Copier et activer la config :
   ```bash
   sudo cp reverse-proxy/nginx.conf /etc/nginx/sites-available/lespapillons
   sudo ln -sf /etc/nginx/sites-available/lespapillons /etc/nginx/sites-enabled/lespapillons
   ```
3. **Indispensable** – supprimer le site par défaut (sinon Nginx affiche toujours "Welcome to nginx") :
   ```bash
   sudo rm -f /etc/nginx/sites-enabled/default
   ```
4. Tester et recharger : `sudo nginx -t && sudo systemctl reload nginx`
5. Tout démarrer en une commande **depuis la racine du projet** :
   ```bash
   npm run start:all
   ```
   Ce script démarre Nginx (sous Linux : `sudo systemctl start nginx`, sous Windows : service Nginx si présent) puis lance l’app (frontend 8080 + backend 3000). Fonctionne sur Linux et Windows.

   Alternative : démarrer Nginx à part, puis `npm start` pour l’app uniquement.

Les visiteurs utilisent uniquement `http://ton-domaine.com` (port 80). Plus tard, tu pourras ajouter le SSL (HTTPS) sur le même Nginx.
