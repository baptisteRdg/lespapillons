# 🦋 Les Papillons

Application cartographique interactive pour découvrir des activités locales.

## 🚀 Démarrage Rapide

### 1. Installation
```bash
npm run install:all
```

### 2. Importer vos Données (GeoJSON)
```bash
# Placez vos fichiers .geojson dans data/geojson/
# Puis lancez :
npm run import
```

### 3. Lancer l'application
```bash
npm start          # Dev local : frontend 8080 + backend 3000
npm run start:all  # Production (Linux) : Nginx + backend, port 80
```
Local : Frontend http://localhost:8080, Backend http://localhost:3000, Swagger http://localhost:3000/api-docs

## 🛠️ Stack

- **Frontend** : MapLibre GL JS, Vanilla JS
- **Backend** : Node.js, Express
- **Carte** : Carto Light

## ✨ Fonctionnalités

- 🗺️ Carte interactive + recherche par rayon
- 📍 Marqueur draggable avec cercle ajustable
- 🔍 Recherche (nom, type, ville)
- ⭐ Favoris (localStorage + base de données)
- 🚗 Itinéraires Google Maps
- 🎨 UI Glass Morphism
- ⚡ Chargement optimisé
- 📂 Import GeoJSON automatique
- 🗄️ API REST complète (Swagger)

## 📁 Structure

```
LesPapillons/
├── data/
│   └── geojson/              # 📥 Vos fichiers .geojson ici
│       ├── nightclubs.geojson
│       └── restaurants.geojson
├── frontend/
│   ├── index.html
│   ├── styles/main.css
│   ├── scripts/
│   │   ├── api.js            # Gestion données
│   │   └── map.js            # Logique carte
│   └── package.json
├── backend/
│   ├── app.js                # API REST
│   ├── start.js              # Démarrage auto (gestion port)
│   ├── swagger.json          # Documentation API
│   ├── scripts/
│   │   └── import.js         # Import GeoJSON → DB
│   ├── helpers/
│   │   └── geojson.js        # Conversion GeoJSON
│   ├── prisma/
│   │   ├── schema.prisma     # Schéma base de données
│   │   ├── seed.js           # Données de test
│   │   └── dev.db            # Base SQLite
│   └── package.json
├── reverse-proxy/            # Nginx (config + setup-nginx.sh)
├── scripts/                  # start-all.js
└── package.json              # Scripts globaux
```

## 📖 Documentation

- **Import GeoJSON** : Voir `data/geojson/README.md`
- **Format GeoJSON** : Voir `backend/GEOJSON.md`
- **API et Base de données** : Voir `backend/DATABASE.md`
- **Swagger** : http://localhost:3000/api-docs

## 📝 License

ISC - Baptiste Rodrigues

