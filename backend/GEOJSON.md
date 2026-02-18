# 📦 Format GeoJSON

Ce document explique le format GeoJSON attendu et comment les données sont converties.

## 🗺️ Structure Attendue

Le script d'import attend un format **FeatureCollection** :

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [longitude, latitude]
      },
      "properties": {
        "name": "Nom de l'activité",
        "amenity": "nightclub",
        "addr:street": "Rue de la Fête",
        "addr:housenumber": "42",
        "addr:postcode": "75001",
        "addr:city": "Paris",
        "website": "https://example.com",
        "phone": "+33 1 23 45 67 89",
        "opening_hours": "Mo-Su 22:00-06:00",
        "...": "autres propriétés"
      }
    }
  ]
}
```

## 🔄 Mapping Automatique

### Champs Obligatoires

| Champ GeoJSON | Champ BD | Description |
|--------------|----------|-------------|
| `name`, `name:fr`, `name:en` | `name` | Nom de l'activité |
| `amenity`, `tourism`, `leisure`, `shop` | `type` | Type (mappé automatiquement) |
| `coordinates[0]` | `longitude` | Longitude |
| `coordinates[1]` | `latitude` | Latitude |

### Champs Optionnels

| Champ GeoJSON | Champ BD | Description |
|--------------|----------|-------------|
| `addr:*` | `address` | Adresse complète |
| `phone`, `contact:phone` | `phone` | Téléphone |
| `website`, `contact:website`, `url` | `website` | Site web |
| `description` | `description` | Description |
| `opening_hours` | `openingHours` | Horaires |
| *autres* | `properties` | Stockés en JSON |

## 🏷️ Mapping des Types

Le script convertit automatiquement les tags OSM en types :

### Amenity → Type

```
nightclub    → vie nocturne
restaurant   → restaurant
cafe         → café
bar          → bar
cinema       → cinéma
theatre      → théâtre
museum       → musée
...
```

### Tourism → Type

```
attraction   → attraction
museum       → musée
viewpoint    → point de vue
zoo          → zoo
hotel        → hôtel
...
```

### Leisure → Type

```
park         → parc
garden       → jardin
playground   → aire de jeux
sports_centre → centre sportif
swimming_pool → piscine
...
```

### Shop → Type

```
mall         → centre commercial
supermarket  → supermarché
bakery       → boulangerie
clothes      → vêtements
...
```

Voir le mapping complet dans `backend/scripts/import.js`.

## 📋 Exemple Complet

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [2.3522, 48.8566]
      },
      "properties": {
        "name": "Le Rex Club",
        "amenity": "nightclub",
        "addr:street": "Boulevard Poissonnière",
        "addr:housenumber": "5",
        "addr:postcode": "75002",
        "addr:city": "Paris",
        "website": "https://www.rexclub.com",
        "phone": "+33 1 42 36 10 96",
        "opening_hours": "Fr-Sa 23:30-07:00",
        "capacity": "800",
        "music_genre": "techno",
        "wheelchair": "no"
      }
    },
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [2.3376, 48.8606]
      },
      "properties": {
        "name": "Musée du Louvre",
        "tourism": "museum",
        "addr:street": "Rue de Rivoli",
        "addr:postcode": "75001",
        "addr:city": "Paris",
        "website": "https://www.louvre.fr",
        "phone": "+33 1 40 20 50 50",
        "description": "Le plus grand musée d'art au monde",
        "opening_hours": "Mo,Th-Su 09:00-18:00; We 09:00-21:45",
        "architect": "I. M. Pei",
        "unesco": "yes"
      }
    }
  ]
}
```

## 🔍 Propriétés Flexibles

Toutes les propriétés qui ne correspondent pas aux champs connus sont stockées dans le champ `properties` (JSON string) de la base de données.

Exemple :
- `capacity` → stocké dans `properties`
- `music_genre` → stocké dans `properties`
- `architect` → stocké dans `properties`

Ces propriétés sont préservées et peuvent être récupérées via l'API.

## ⚠️ Points d'Attention

1. **Coordonnées** : Toujours `[longitude, latitude]` (GeoJSON standard)
2. **Type** : Si `amenity`, `tourism`, `leisure`, ou `shop` est absent, vous pouvez ajouter `"type": "votre_type"`
3. **Nom** : Au moins un des champs `name`, `name:fr`, `name:en` doit être présent
4. **Features invalides** : Les features sans coordonnées ou sans nom sont ignorées (avec message d'erreur)

## 🚀 Import

```bash
# 1. Placez vos .geojson dans data/
cp mes-donnees.geojson data/

# 2. Lancez l'import
npm run import

# 3. Vérifiez les résultats
cd backend && npm run db:studio
```

## 📊 Sources de Données

### OpenStreetMap (Overpass API)

Vous pouvez exporter des données depuis :
- [Overpass Turbo](https://overpass-turbo.eu/) : Interface visuelle
- [HOT Export Tool](https://export.hotosm.org/) : Export par région
- [GeoJSON.io](http://geojson.io/) : Créer/éditer manuellement

### Export Overpass Turbo

```
[out:json];
(
  node["amenity"="nightclub"]({{bbox}});
  way["amenity"="nightclub"]({{bbox}});
  relation["amenity"="nightclub"]({{bbox}});
);
out center;
```

Puis "Export" → "données" → "GeoJSON"
