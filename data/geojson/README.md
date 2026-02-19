# 📁 Dossier GeoJSON

Placez vos fichiers `.geojson` ici pour les importer dans la base de données.
Les fichiers présent sont pris en compte dans le dépôt git.


## Format Attendu

Le format **FeatureCollection** avec des `Point` :

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
        "addr:city": "Paris",
        "website": "https://example.com",
        "phone": "+33 1 23 45 67 89"
      }
    }
  ]
}
```

## Type d'activité = nom du fichier

À l'import, **le type de toutes les activités d'un fichier** est dérivé du **nom du fichier** (pas des tags OSM). Ex. : `laser-game.geojson` → type `"laser game"`, `cinema.geojson` → type `"cinema"`. Les tirets et underscores sont convertis en espaces. Tu peux ensuite mapper ces types aux icônes dans `frontend/scripts/map.js` (objet `getIconConfig`).

## Génération de la base de données 

Depuis la **racine du projet** :

```bash
npm run import
```
Tous les fichiers `.geojson` de ce dossier seront importés automatiquement dans une seule base de données, celle-ci sera présente dans le dossier **backend/prisma**
avec comme nom **dev.db**

## Backup

Une backup de la base de données est réalisé à chaque nouvelle génération, chaque fichier possède dans le nom du fichier la date et l'heure.
les fichiers de backup sont présent dans le dossier **data/backup**, les fichiers ne sont pas pris en compte par git.