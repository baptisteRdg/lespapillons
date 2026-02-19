#!/bin/bash
# Copie la config, supprime le site default, démarre Nginx.
# Si la config déployée contient déjà le SSL (Certbot), on ne l'écrase pas.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NGINX_AVAILABLE="/etc/nginx/sites-available"
NGINX_ENABLED="/etc/nginx/sites-enabled"
SITE_NAME="lespapillons"
TARGET="$NGINX_AVAILABLE/$SITE_NAME"

if [ -f "$TARGET" ] && grep -q "listen 443\|ssl_certificate" "$TARGET" 2>/dev/null; then
  # Config déjà modifiée par Certbot, ne pas écraser
  echo "Config Nginx avec SSL déjà présente, conservation."
else
  cp "$SCRIPT_DIR/nginx.conf" "$TARGET"
fi

ln -sf "$TARGET" "$NGINX_ENABLED/$SITE_NAME"
rm -f "$NGINX_ENABLED/default"
nginx -t && systemctl start nginx && systemctl reload nginx
