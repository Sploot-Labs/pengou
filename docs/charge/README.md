# Tests de charge

Une campagne de charge se lance à la main, sur un poste sans autre charge. Elle reconstruit l'image de production, puis, pour chaque passage, repart d'une base neuve, attend que le serveur réponde, joue une partie simulée et vérifie que la base contient bien tous les joueurs et toutes les réponses. Le rapport de référence est `2026-10-31-resultats.md`.

## Prérequis

Docker doit être démarré et le port 3000 libre : arrêtez le serveur de dev (`pnpm dev`) avant de lancer, sinon une partie des requêtes peut arriver sur lui. Le `.env` à la racine du dépôt doit définir `SESSION_SECRET`, `BETTER_AUTH_SECRET` et les limites du VPS reproduites par les conteneurs : `PENGOU_CHARGE_CPUS=4`, `PENGOU_CHARGE_MEM=15360m` et `PENGOU_CHARGE_MEMSWAP=15360m`. Il ne faut pas lancer le générateur de charge seul (`pnpm ... charge`) en même temps, ni lire `/metrics` pendant une campagne.

## Lancer une campagne

```sh
pnpm --filter @splootlabs/server charge:campagne -- --scenario rapide
```

Le scénario `rapide` (par défaut) joue une fois 640 joueurs, 800 joueurs et dix parties de 30 joueurs, en une dizaine de minutes. Le scénario `complet` reprend le protocole du rapport de référence : les paliers 300, 500, 750, 800, 900 et 1000 deux fois chacun, dix parties de 30 deux fois et une rafale de 800 joueurs à 250 arrivées par seconde, soit environ une heure. Les scénarios sont définis dans `apps/server/charge/scenarios.mjs`.

L'option `--pause` règle l'attente après le démarrage du serveur (30 secondes par défaut) et `--sans-build` réutilise l'image déjà construite.

## Lire les résultats

Chaque campagne écrit ses fichiers dans `charge-resultats/<date>-<commit>/` (ignoré par git) : le JSON complet de chaque passage et un `resume.md`, aussi affiché en fin de campagne. Elle ajoute une ligne par passage à `docs/charge/historique.jsonl`, avec le commit, la machine et les chiffres clés.

Chaque passage est comparé à la dernière campagne de l'historique jouée sur le même processeur avec les mêmes paramètres. Une régression est signalée quand un passage qui réussissait ne réussit plus, ou quand la réponse p95, la diffusion p95, le lag p95 ou le join p95 dépasse 1,5 fois la référence avec au moins 20 ms d'écart. Le lag p95 (sur les mesures seconde par seconde) est plus stable que le maximum retenu par le verdict, qui peut échouer sur un seul pic.

La commande sort en code 0 si tout a réussi sans régression, 1 si un passage échoue ou régresse, 2 si la pile n'a pas pu démarrer.

Pour garder une campagne comme référence, committez `docs/charge/historique.jsonl`. Pour l'écarter (poste chargé, essai de réglage), retirez ses lignes du fichier avant de committer. Les premières lignes reprennent la campagne du 31 octobre 2026 (commit 9011613), importée comme référence initiale.
