# Tests & Benchmark

## Lancer

Le backend doit tourner avant de lancer les tests.

```bash
# tout (santé + benchmark)
npm test

# santé seule
node tests/health.js

# benchmark seul
node tests/benchmark.js
```

Par défaut ça tape sur `http://localhost:3000`.

## Tests de santé

Vérifie que tout répond : front (fichiers statiques), API (activités, détails, recherche, filtres), base de données (données valides, pas de doublons), auth (login test 490, JWT, rejet sans token), routes protégées (todo, done, ratings).

Si tout est vert, la stack fonctionne. Si un test est rouge, le message dit exactement ce qui ne va pas.

## Benchmark

Mesure les temps de réponse de chaque endpoint (séquentiel puis en parallèle). A la fin il donne :

- **Score /1000** : plus c'est haut, plus c'est rapide. Compare ce chiffre entre deux runs pour voir si tu as amélioré ou dégradé les perfs.
- **Latence moyenne** : temps moyen pondéré en ms.
- **Débit** : requêtes par seconde en charge.

Les résultats sont sauvegardés dans `tests/benchmark-history.json`. A chaque run il affiche l'évolution par rapport au run précédent.

Concrètement : tu fais un changement, tu relances `node tests/benchmark.js`, et tu regardes si le score monte ou descend.
