# Données Open Trivia Database

Les questions de ce dossier (en anglais) proviennent d'Open Trivia Database (https://opentdb.com),
base de questions contributive créée et maintenue par PIXELTAIL GAMES LLC.

Licence : Creative Commons Attribution - Partage dans les mêmes conditions 4.0 International
(CC BY-SA 4.0), https://creativecommons.org/licenses/by-sa/4.0/

Le site indique (https://opentdb.com/api_config.php) : « All data provided by the API is
available under the Creative Commons Attribution-ShareAlike 4.0 International License. »

## Modifications

Les fichiers de ce dossier sont une adaptation des questions d'origine. Une première conversion,
faite par le script `packages/library/scripts/convert-opentdb.ts`, a mis les questions au format
des packs Pengou : classement par thème (d'après la catégorie d'origine), difficulté (easy, medium,
hard deviennent facile, moyen, difficile) et public, ordre des propositions déterminé par le script,
retrait des questions dont l'énoncé figurait déjà plus haut.

Le script `packages/library/scripts/curate-opentdb.ts` a ensuite retouché ces fichiers, d'après
la liste de `packages/library/scripts/opentdb-plans.ts` :

- retrait de questions dépassées, fausses, douteuses, ambiguës ou incompréhensibles, chacune avec
  son motif ;
- reclassement de questions dans un autre thème ;
- remplacement des quiz tirés automatiquement par des quiz composés à la main : quiz thématiques,
  quiz qui mêlent plusieurs thèmes et quiz par décennie, dont l'ordre des questions a été tiré au
  hasard une fois. Chaque quiz qui mêle plusieurs thèmes a son propre pack dans `composes/`.

Le texte des questions et des réponses n'est pas modifié, hormis la normalisation des espaces.

Cette adaptation est diffusée sous la même licence, CC BY-SA 4.0. Elle ne relève pas de la
licence Apache-2.0 du code de Pengou.

## Attribution

Attribution à reprendre : « Questions from the Open Trivia Database (https://opentdb.com), by
PIXELTAIL GAMES LLC and contributors, licensed under CC BY-SA 4.0 ».
