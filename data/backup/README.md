# Dossier de Sauvegarde de la Base de Données

Ce dossier contient les sauvegardes automatiques de la base de données.

## 📅 Nom des fichiers

Format : `dev_YYYY-MM-DD_HHhMM.db`

Exemple : `dev_2026-02-18_14h30.db`

## 🔄 Quand sont créées les sauvegardes ?

Une sauvegarde est **automatiquement créée avant chaque import** (`npm run import`).

## 📦 Restaurer une sauvegarde

```bash
# Windows
copy data\backup\dev_2026-02-18_14h30.db backend\prisma\dev.db

# Linux/Mac
cp data/backup/dev_2026-02-18_14h30.db backend/prisma/dev.db
```

## 🧹 Nettoyage

Les sauvegardes ne sont **pas supprimées automatiquement**. 

Pour nettoyer les anciennes sauvegardes :

```bash
# Supprimer les sauvegardes de plus de 7 jours (Linux/Mac)
find data/backup/ -name "dev_*.db" -mtime +7 -delete

# Ou manuellement
rm data/backup/dev_2026-01-*.db
```

## 📁 Structure

```
data/
  backup/               # Backups de la base de données
    dev_2026-02-18_10h11.db
    dev_2026-02-18_14h30.db
  geojson/             # Fichiers GeoJSON à importer
    nightclubs.geojson
    restaurants.geojson
```
