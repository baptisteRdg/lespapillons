# Icônes des types d'activité

**Règle :** le type d'activité = le nom du fichier SVG (sans l'extension).

- Type en base : `nightclub` → le frontend charge **nightclub.svg**
- Type : `laser game` → fichier **laser-game.svg** (espaces → tirets)

Tu ajoutes un SVG ici avec le même nom que le type (ex. `laser-game.svg` pour le type `laser game`). Si le fichier n'existe pas, une icône par défaut s'affiche.

**Import :** le type vient du **nom du fichier GeoJSON** à l'import (`data/geojson/`). Ex. `laser-game.geojson` → toutes les activités du fichier ont le type `"laser game"`. Donc nom du fichier GeoJSON = type = nom du SVG (avec espaces pour le type, tirets pour le fichier).
