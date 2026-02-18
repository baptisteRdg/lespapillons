# 📁 Dossier GeoJSON

Placez vos fichiers `.geojson` ici pour les importer dans la base de données.

## 📝 Format Attendu

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

## 🚀 Import

Depuis la **racine du projet** :

```bash
npm run import
```

✅ Tous les fichiers `.geojson` de ce dossier seront importés automatiquement.

## 📖 Documentation Complète

Pour plus de détails sur le format et le mapping automatique :
- Voir `backend/GEOJSON.md` pour la documentation complète
- Les propriétés OSM (`amenity`, `tourism`, `leisure`, `shop`) sont mappées automatiquement

## 📦 Exemples

- `nightclubs.geojson` : 2620 activités importées ✅
- `exemple-paris.geojson` : 2 activités de test ✅
