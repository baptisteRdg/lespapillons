# 🗄️ Configuration Base de Données + Swagger

## 📦 Installation

```bash
cd backend
npm install
```

## 🚀 Initialisation de la Base de Données

### 1. Créer la base de données SQLite

```bash
npm run db:init
```

Cette commande va :
- Créer le fichier `dev.db` (base SQLite)
- Créer les tables `activities` et `favorites`
- Générer le client Prisma

### 2. Importer vos Données (Recommandé)

#### Option A : Import GeoJSON (Professionnel)

```bash
# 1. Placez vos fichiers .geojson dans data/geojson/
# 2. Lancez l'import
npm run import
```

**Avantages** :
- ✅ Import automatique de tous vos fichiers `.geojson`
- ✅ Mapping automatique des tags OSM (amenity, tourism, leisure, shop)
- ✅ Gestion flexible des propriétés personnalisées
- ✅ Rapport détaillé des succès/erreurs
- ✅ Vidage optionnel de la base avant import

**Format GeoJSON attendu** : Voir `data/geojson/README.md`

#### Option B : Données de Test

```bash
npm run db:seed
```

Cela va insérer 2 activités de test :
- Musée du Louvre
- Parc des Buttes-Chaumont

## 🎯 Lancer le Serveur

```bash
npm start
```

Le serveur démarre sur **http://localhost:3000**

## 📖 Accéder à Swagger

Ouvrez votre navigateur : **http://localhost:3000/api-docs**

Vous pouvez maintenant :
- ✅ Voir toutes les routes documentées
- ✅ Tester chaque endpoint directement depuis le navigateur
- ✅ Créer, modifier, supprimer des activités
- ✅ Gérer les favoris

## 🔧 Utiliser Prisma Studio (Interface Visuelle)

Pour gérer la base de données visuellement :

```bash
npm run db:studio
```

Cela ouvre une interface web sur **http://localhost:5555** où vous pouvez :
- Voir toutes les tables
- Ajouter/modifier/supprimer des données
- Explorer les relations

## 📋 Champs de la Base de Données

### Table `activities`

| Champ | Type | Obligatoire | Description |
|-------|------|-------------|-------------|
| `id` | Integer | Auto | ID unique |
| `name` | String | ✅ OUI | Nom de l'activité |
| `type` | String | ✅ OUI | Type (musée, parc, etc.) |
| `latitude` | Float | ✅ OUI | Latitude GPS |
| `longitude` | Float | ✅ OUI | Longitude GPS |
| `address` | String | ❌ Non | Adresse complète |
| `phone` | String | ❌ Non | Téléphone |
| `website` | String | ❌ Non | Site web |
| `description` | String | ❌ Non | Description |
| `openingHours` | String | ❌ Non | Horaires |
| `createdAt` | DateTime | Auto | Date création |
| `updatedAt` | DateTime | Auto | Date modification |

### Table `favorites`

| Champ | Type | Description |
|-------|------|-------------|
| `id` | Integer | ID unique |
| `userId` | String | ID utilisateur |
| `activityId` | Integer | ID activité (relation) |
| `createdAt` | DateTime | Date d'ajout |

## 🎯 Exemples d'Utilisation avec Swagger

### 1. Créer une Activité

1. Allez sur http://localhost:3000/api-docs
2. Trouvez `POST /api/activities`
3. Cliquez sur "Try it out"
4. Remplissez :

```json
{
  "name": "Tour Eiffel",
  "type": "monument",
  "latitude": 48.8584,
  "longitude": 2.2945,
  "address": "Champ de Mars, 75007 Paris",
  "phone": "+33 1 44 11 23 23",
  "website": "https://www.toureiffel.paris",
  "description": "Monument emblématique de Paris",
  "openingHours": "9h30-23h45"
}
```

5. Cliquez "Execute"

### 2. Récupérer Toutes les Activités

1. `GET /api/activities`
2. Cliquez "Try it out" → "Execute"

### 3. Filtrer par Type

1. `GET /api/activities`
2. Dans `type`, mettez : `musée`
3. Execute

### 4. Recherche par Rayon

1. `GET /api/activities`
2. Remplissez :
   - `lat` : 48.8566
   - `lng` : 2.3522
   - `radius` : 5000 (5km)
3. Execute

### 5. Ajouter un Favori

1. `POST /api/favorites`
2. Body :

```json
{
  "activityId": 1
}
```

3. Execute

### 6. Voir Mes Favoris

1. `GET /api/favorites`
2. Execute

## 🔄 Réinitialiser la Base de Données

Si vous voulez recommencer à zéro :

```bash
# Supprimer la base
rm prisma/dev.db

# Recréer et réinitialiser
npm run db:init
npm run db:seed
```

## 📝 Scripts Disponibles

```bash
# Lancer le serveur
npm start

# Lancer en mode dev (auto-reload)
npm run dev

# Initialiser la base de données
npm run db:init

# Remplir avec des données de test
npm run db:seed

# Ouvrir Prisma Studio
npm run db:studio
```

## 🎨 Structure des Fichiers

```
backend/
├── app.js              # Serveur Express + routes
├── swagger.json        # Documentation API
├── package.json        # Dépendances + scripts
├── prisma/
│   ├── schema.prisma   # Schéma de la base
│   ├── seed.js         # Données de test
│   └── dev.db          # Base SQLite (généré)
└── node_modules/
```

## 🚨 Troubleshooting

### Erreur : "Prisma Client not found"
```bash
npx prisma generate
```

### Erreur : "Database locked"
Fermez Prisma Studio si ouvert :
```bash
# Tuer le processus sur port 5555
npx kill-port 5555
```

### Erreur : "Table already exists"
```bash
rm prisma/dev.db
npm run db:init
```

## 🎉 Vous êtes prêt !

1. ✅ Base de données configurée
2. ✅ Swagger accessible
3. ✅ API REST complète
4. ✅ CRUD sur activités
5. ✅ Gestion des favoris

Testez maintenant sur : **http://localhost:3000/api-docs**
