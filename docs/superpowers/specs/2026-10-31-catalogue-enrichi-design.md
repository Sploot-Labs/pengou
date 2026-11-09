# Catalogue enrichi : nouvelles sources, traductions et quiz par génération

Conception, 2026-10-31. Fait suite à `2026-10-30-bibliotheque-questions-design.md`.

## Intention et pourquoi

La bibliothèque livrée le 2026-10-31 contient 2 686 questions : 1 537 en français
(OpenQuizzDB) et 1 149 en anglais (Open Trivia DB). Elle sert mal l'usage visé, monter
vite un quiz pour une soirée entre francophones :

- seules 441 questions figurent dans les 27 quiz tout prêts, dont 6 sont en anglais ;
- les questions anglaises ne servent pas à un public français, et les françaises ne
  servent pas à un public anglophone ;
- il n'existe aucun quiz qui mélange les thèmes, alors que c'est le format que Julien
  utilise le plus (ses « Quiz mix culture » faits main) ;
- rien ne joue sur la nostalgie d'une génération, alors que c'est ce qui marche le
  mieux en soirée (« tu te souviens de… ») ;
- certains thèmes sont maigres en français (8 questions de jeux vidéo, 32 d'art) et
  quelques questions sont mal classées (Toad, de Mario, rangé en cinéma).

Ce travail ne touche qu'au contenu du catalogue et aux scripts qui le produisent. Aucun
changement de l'application (schéma, base, serveur, écrans).

## Objectifs

1. Nouvelles questions françaises : intégrer les catégories OpenQuizzDB TELEVISION
   (35 quiz source) et CELEBRITES (21 quiz source), écartées à la première conversion
   faute de thème. Deux thèmes sont ajoutés à `catalog/themes.json` :
   `television` (« Télévision ») et `people` (« Célébrités »).
2. Traduire en français les questions d'Open Trivia DB qui parlent à un public français.
   Les questions anglaises d'origine restent en place.
3. Traduire en anglais les questions françaises d'OpenQuizzDB (existantes et nouvelles)
   qui parlent à un public anglophone. Les questions françaises d'origine restent en place.
4. Des quiz tout prêts en trois familles, en français, chacun doublé de sa version
   anglaise quand ses questions sont toutes traduites :
   - thématiques : compléter les thèmes peu ou pas couverts (télévision, célébrités,
     jeux vidéo, art, littérature, sciences, etc.), en visant au moins deux quiz
     français par thème ;
   - mix : quiz mêlant plusieurs thèmes, ordre des questions mélangé, dans l'esprit
     des « Quiz mix culture » (une dizaine) ;
   - par génération : un quiz par décennie (années 70, 80, 90, 2000, 2010), mêlant
     télévision, musique, cinéma, jeux, sport et people de l'époque, pour que chacun
     y retrouve sa jeunesse. Plusieurs quiz par décennie si la matière le permet.
5. Retoucher l'existant : corriger les thèmes erronés, écarter les questions dépassées
   ou fausses, remplacer les 6 quiz anglais actuels (tirés automatiquement, « les 15
   premières questions ») par des quiz composés à la main.

## Non-objectifs

- Étiquettes libres sur les questions, nouveau filtre, nouveau champ du format de pack :
  écartés explicitement par Julien (« pas besoin pour l'instant »). Le champ `language`
  et le filtre Langue existant suffisent à séparer originaux et traductions.
- Insérer des quiz dans le compte de Julien en base : tout passe par le catalogue.
- Modifier l'écran Bibliothèque ou l'API.
- Corpus Qulture (data.gouv.fr, CC BY 4.0) : 16 questions par langue seulement, avec des
  réponses trop longues pour les tuiles. Laissé de côté.

## Anti-objectifs

- Une traduction fausse ou bancale : réponse qui ne correspond plus à la question,
  jeu de mots perdu, unité ou référence culturelle incompréhensible. Mieux vaut ne pas
  traduire une question que mal la traduire.
- Un quiz par génération qui se trompe d'époque (une série des années 90 dans le quiz
  des années 80) : c'est l'erreur qui casse l'effet nostalgie.
- Des questions devenues fausses avec le temps (« actuel président », record battu,
  « dernier album ») présentées comme justes.
- Enfreindre CC BY-SA 4.0 : toute traduction est une adaptation, qui doit citer la
  source d'origine, signaler la modification et rester sous CC BY-SA 4.0.
- Faire échouer la CI : `pnpm lint`, `pnpm typecheck` et `pnpm test` doivent passer.
  Ne jamais lancer `biome format --write`.

## Contraintes du format existant (à respecter, pas à changer)

Voir `packages/library/src/schema.ts` et `src/read.ts`.

- Un pack a une seule `source`, appliquée à toutes ses questions.
- Un quiz ne peut référencer que des questions de son propre pack. Un quiz mix ou par
  génération réunit donc des questions d'une seule famille de source (OpenQuizzDB ou
  Open Trivia DB). Pour OpenQuizzDB, le script existant le fait déjà en déplaçant les
  questions des quiz source vers un pack « composé » dont la source vaut
  « OpenQuizzDB, plusieurs auteurs » ; il faudra seulement permettre de composer à
  partir d'une liste explicite de questions, pas uniquement de quiz source entiers.
- Identifiants de question uniques dans tout le catalogue et stables : une question
  déjà livrée garde son identifiant.
- Tests du catalogue (`src/catalog.test.ts`) : quiz de 10 à 20 questions, pas d'énoncé
  en double (normalisé) dans une même langue, chaque thème utilisé, chaque question
  OpenQuizzDB cite son rédacteur (`OpenQuizzDB, <nom>`), un `LICENSE*` par dossier.
  La règle sur le rédacteur s'applique aux identifiants `oqdb-` : les traductions
  doivent donc la respecter aussi, ou porter un autre préfixe (voir plus bas).
- QCM à 4 propositions, une seule bonne réponse, propositions de 1 à 4 mots environ
  (25 caractères au plus) pour tenir dans une tuile mobile. Les vrai/faux d'Open
  Trivia DB restent des vrai/faux.

## Ce qui est décidé

- Les traductions vivent dans des packs séparés des originaux, un dossier par couple
  source et langue : `catalog/openquizzdb-en/` (OpenQuizzDB traduit en anglais) et
  `catalog/opentdb-fr/` (Open Trivia DB traduit en français), chacun avec son
  `LICENSE.md` qui cite la source d'origine et décrit la traduction.
- Identifiant d'une traduction : celui de l'original suffixé de la langue
  (`oqdb-0027-1-en`, `otdb-1a2b3c-fr`), pour retrouver l'original d'un coup d'œil.
- Source d'un pack traduit : celle de l'original avec la mention de la traduction,
  par exemple `OpenQuizzDB, Philippe Bresoux (traduction Sploot Labs)`, même licence,
  même lien.
- Les traductions sont faites par Claude puis relues par une seconde passe de Claude,
  sans relecture humaine (choix de Julien), et rangées dans des tables
  versionnées hors du dossier `catalog/` (qui ne doit contenir que des packs), par
  exemple `packages/library/translations/`, avec une note de licence CC BY-SA. Un
  script les applique aux packs d'origine pour produire les packs traduits : relancer
  le script redonne les mêmes fichiers.
- Une question n'est traduite que si elle fonctionne dans l'autre culture. Sont
  écartées notamment : sports et émissions purement américains ou purement français
  sans notoriété hors du pays, jeux de mots, questions sur la langue elle-même.
  Les questions écartées sont listées avec leur motif dans la table de traduction.
- Les questions dépassées ou fausses sont écartées (pas réécrites) via une liste
  d'exclusions motivées dans le script de conversion. Les reclassements de thème se
  font via une liste de surcharges par question. Le `LICENSE.md` d'OpenQuizzDB est mis
  à jour pour décrire ces retraits et reclassements.
- Quiz de 10 à 20 questions (règle des tests), 20 visé pour les mix et les quiz par
  génération. Ordre des questions mélangé une fois pour toutes dans les mix et les
  quiz par génération ; ordre des propositions inchangé (déjà bien réparti).
- Thème des quiz mix et par génération : `culture-generale`.
- Difficulté : OpenQuizzDB n'en donne pas, tout reste « moyen ». Les traductions
  gardent la difficulté de l'original.

## Choix faits à la relecture (décisions de Claude, à vérifier par Julien)

- Les quiz livrés ne sont pas démontés. Les nouveaux quiz (thématiques, mix, par
  génération) puisent seulement dans les questions qui ne figurent dans aucun quiz :
  environ 1 100 questions françaises d'OpenQuizzDB déjà livrées, plus les nouvelles
  catégories TELEVISION et CELEBRITES. Les questions des packs `quiz/NNNN.json`
  déplacées vers un pack composé y perdent leur rédacteur au profit de « OpenQuizzDB,
  plusieurs auteurs » : c'est accepté, le `LICENSE.md` garde le détail par quiz source.
  Exception : les 6 quiz anglais d'Open Trivia DB sont remplacés.
- Toutes les questions qui se prêtent à la traduction sont traduites, pas seulement
  celles des quiz : Julien veut une bibliothèque complète dans les deux langues.
- Les quiz par génération en français viennent d'OpenQuizzDB uniquement (nostalgie
  française). Open Trivia DB traduit ne sert pas à ces quiz ; il peut servir aux quiz
  par génération anglais.
- Open Trivia DB : sa conversion n'est plus relancée. Un nouveau script part des
  fichiers livrés, applique exclusions et surcharges, recompose les quiz anglais et
  produit les traductions. Les fichiers livrés sont figés une fois ce script en place.
- OpenQuizzDB retéléchargé : le livré gagne toujours. Le script vérifie qu'aucune
  question livrée ne change d'identifiant ni de texte ; une nouvelle question qui
  doublonne une question livrée est écartée, quel que soit son numéro de quiz source.
  Un quiz source livré qui aurait disparu en ligne fait échouer le script plutôt que
  de retirer des questions en silence.

## Laissé au constructeur

- Le choix des questions de chaque quiz, des titres et des descriptions (titres
  courts et parlants, casse de phrase : « Les années 80 », « Mix culture #1 »).
- Le nombre exact de quiz thématiques et mix, dans les ordres de grandeur ci-dessus.
- Le nombre de quiz par décennie, selon la matière disponible. Une décennie sans au
  moins 15 bonnes questions dans une même famille de source n'a pas de quiz : pas de
  questions originales rédigées pour combler (choix de Julien).
- L'organisation des scripts (étendre `convert-openquizzdb.ts` et `convert-opentdb.ts`,
  ajouter un script de traduction), du moment que le résultat est reproductible.
- Le découpage du travail de traduction et de relecture en lots.

## Points d'attention

- Le cache d'OpenQuizzDB n'est pas dans le dépôt : relancer la conversion suppose de
  retélécharger (le script espace déjà ses requêtes). Comparer le résultat aux fichiers
  livrés : une question existante ne doit pas changer d'identifiant ni de texte.
- Le cache d'Open Trivia DB est perdu et l'API tire au hasard : ne pas relancer sa
  conversion. Le pack anglais livré devient la référence, et la composition de ses
  quiz se fait à partir des fichiers livrés.
- Typographie des textes produits (titres, descriptions, traductions françaises) :
  guillemets « », apostrophe droite, pas de tiret cadratin.
