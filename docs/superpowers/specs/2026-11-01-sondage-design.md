# Sondage et fin de partie sans podium

Date : 2026-11-01. Statut : validé en conversation, en attente de relecture du document.

## Intention

Pengou sert aussi à animer des réunions. L'animateur veut pouvoir demander l'avis de la salle sans qu'il y ait de bonne réponse : choisir un sujet, prendre la température, voter entre plusieurs options. Le sondage est ce nouveau type de question. Il complète le nuage de mots (fusionné dans main, commit e1c86b1), qui collecte des idées libres.

Un quiz peut désormais ne contenir aucune question notée (uniquement des sondages et des nuages de mots). Dans ce cas, finir sur un podium où tout le monde a 0 point n'a pas de sens : la partie doit se terminer sur un écran de remerciement.

Une ancienne branche (feat/sondage-nuage-de-mots) avait déjà exploré ce sujet. On repart de zéro sur la base de main ; elle sera supprimée une fois ce travail livré. Elle peut être lue pour s'inspirer, pas reprise.

## Objectifs

1. Un type de question « sondage », en choix unique ou en choix multiple, choisi par l'animateur à la création.
2. Aucun point attribué, aucune bonne réponse, aucun classement après un sondage.
3. La répartition des votes affichée sur le grand écran et chez l'animateur à la clôture.
4. La répartition complète dans le rapport de partie et dans l'export CSV ; les sondages exclus des statistiques de réussite.
5. Une fin de partie sans podium quand le quiz ne contient aucune question notée.

## Non-objectifs

- Afficher la répartition sur le téléphone des participants (décision de l'utilisateur, pour la performance et la simplicité).
- Modifier un vote après validation.
- Sondages anonymes ou nominatifs en option : le comportement reste celui des autres questions (les réponses sont rattachées au joueur comme aujourd'hui).
- Accepter le type sondage dans les paquets de la bibliothèque (packages/library/src/schema.ts). Même situation que le nuage de mots, décision reportée.
- Changer le mode d'envoi des réponses des types classiques.

## Anti-objectifs

- Un sondage ne doit jamais faire apparaître « bonne réponse », « faux », un score ou un classement, ni sur l'écran ni sur le téléphone.
- Un sondage ne doit pas fausser le taux de réussite du rapport (ni être choisi comme « question la plus ratée »).
- Le choix multiple ne doit pas multiplier les envois réseau : une seule réponse par joueur.

## Décisions de l'utilisateur

- Choix unique et choix multiple : les deux, l'animateur choisit à la création.
- Après un sondage : on passe directement à la question suivante, sans écran de classement. Cela vaut dans un quiz mixte comme dans un quiz sans question notée.
- Téléphone du participant : seulement la confirmation du vote, pas la répartition.
- Clôture du vote :
  - choix unique : dès que tout le monde a voté (comme les autres questions), ou à la fin du temps, ou par l'animateur ;
  - choix multiple : à la fin du temps ou quand l'animateur ferme ; pas de clôture automatique quand tout le monde a voté.
- Vote définitif : le participant coche, valide une fois, et ne peut plus changer. Cohérent avec les questions classiques (une réponse) et le nuage de mots (chaque mot définitif).
- Rapport et export : répartition complète, chaque choix avec son nombre de votes et son pourcentage.
- Fin de partie : si aucune question du quiz n'est notée, écran « Merci pour vos réponses » à la place du podium. Dès qu'il y a au moins une question notée, podium habituel.

## Hypothèses validées par l'utilisateur

- Nombre de choix : mêmes bornes que le QCM (2 à 6 options, libellé de 1 à 200 caractères).
- Pourcentages en choix multiple : calculés sur le nombre de participants ayant voté. Leur somme peut dépasser 100 %. En choix unique, cela revient au pourcentage habituel.
- Le nuage de mots suit la même règle « pas de classement après lui » (ce n'est pas le cas aujourd'hui sur main) et compte comme question non notée pour la fin de partie.

## Comportement attendu

### Création (éditeur)

Nouveau type « Sondage » dans l'éditeur, à côté de « Nuage de mots ». L'animateur saisit l'énoncé et les choix, sans case « bonne réponse ». Un réglage indique « Plusieurs réponses possibles » (désactivé par défaut, donc choix unique). Le minuteur et le temps de lecture fonctionnent comme pour les autres types. Libellés « Sondage » dans la bibliothèque et l'aperçu.

### Pendant la partie

- Téléphone, choix unique : le participant touche un choix ; comme pour le QCM, ce geste vaut validation. Écran « Vote enregistré ».
- Téléphone, choix multiple : le participant coche un ou plusieurs choix puis appuie sur « Valider ». Au moins un choix est requis. Écran « Vote enregistré ».
- À la clôture, le téléphone n'affiche ni répartition, ni « correct / incorrect », ni points. Il invite à regarder l'écran.
- Grand écran et animateur pendant le vote : énoncé, choix, compteur « x / y a répondu » comme les autres questions.
- À la clôture : grand écran et animateur affichent la répartition (barres, nombre de votes, pourcentage), sans mise en évidence d'une bonne réponse. Le bouton de l'animateur se nomme « Clore le sondage » (à la place de « Révéler la réponse »).
- Ensuite : pas d'écran de classement. Le passage à la question suivante se fait par l'animateur ou par l'enchaînement automatique s'il est actif (même délai qu'aujourd'hui, compté depuis l'affichage de la répartition). En fin de quiz, on va vers le podium ou l'écran de remerciement.

### Fin de partie

« Aucune question notée » signifie : toutes les questions du quiz sont des sondages ou des nuages de mots. Dans ce cas :

- grand écran et animateur : « Merci pour vos réponses » et le titre du quiz, sans podium ni confettis de classement ;
- téléphone : « Merci pour tes réponses » (tutoiement, comme le reste de l'écran joueur) ;
- les actions habituelles de fin (relancer, voir le rapport) restent disponibles pour l'animateur.

### Rapport de partie

- Chaque sondage affiche sa répartition complète : chaque choix, son nombre de votes, son pourcentage sur les participants ayant voté, et le nombre de participants.
- Les sondages, comme les nuages de mots, sont exclus des statistiques de réussite et du choix de la question la plus ratée.

### Export CSV

Une section par sondage, sur le modèle de celle du nuage de mots : un titre « Sondage : <énoncé> (N participants) », puis les colonnes Choix, Votes, Pourcentage, une ligne par choix dans l'ordre de création.

## Contraintes techniques

- Monorepo pnpm : packages/quiz (registre des types, zod), packages/db (Drizzle, migrations SQL écrites à la main après 0015 avec une entrée ajoutée dans meta/_journal.json ; la dernière est 0020_wordcloud.sql), packages/game (moteur), apps/server (Fastify, Socket.IO, export CSV), apps/web (React).
- Nouvelle valeur 'poll' dans l'enum Postgres question_type, par migration 0021.
- Le moteur appelle aujourd'hui `isCorrect` et `score` pour chaque type ; le sondage doit produire aucun point et un résultat `correct: null`, comme le nuage de mots, tout en renvoyant une distribution par choix.
- Le nuage de mots désactive déjà la clôture automatique « tous ont répondu » (packages/game/src/engine.ts) ; le sondage en choix multiple suit la même voie, le choix unique non.
- Le serveur émet aujourd'hui `question:reveal` puis `scoreboard` à chaque clôture, et les clients basculent seuls de la révélation au classement après un délai. Pour une question non notée, les clients restent sur la révélation ; le serveur peut continuer à émettre le classement (inchangé) ou s'en abstenir, au choix du constructeur.
- Ne jamais lancer biome format --write sur le dépôt.
- Typographie des textes visibles : pas de tiret cadratin ni demi-cadratin, guillemets « », apostrophe droite.
- Vérification : pnpm typecheck, pnpm lint (0 erreur), pnpm test.

## Choix tranchés après relecture (décisions de Claude, à vérifier par l'utilisateur)

- Statistiques par joueur et par question : les sondages sont exclus de tout ce qui mesure la réussite ou la vitesse, comme le nuage de mots aujourd'hui (filtre de packages/db/src/repos/reports.ts étendu de `type <> 'wordcloud'` à `type not in ('wordcloud', 'poll')`) : bonnes réponses, réponses données, temps moyen. Un vote de sondage ne doit jamais compter comme une mauvaise réponse.
- Sondage sans aucun vote : pas de pourcentage, la mention « Aucun vote » à la place de la répartition (écran, animateur, rapport ; l'export garde ses lignes de choix à 0 vote et 0 %).
- « Nombre de participants » du sondage (rapport, export, base des pourcentages) : les joueurs ayant voté.
- Après un sondage ou un nuage de mots, le serveur continue d'émettre `scoreboard` (l'état reste cohérent), les clients l'ignorent pour une question non notée et restent sur la révélation ; l'enchaînement automatique part de la révélation.
- Résultat de clôture : un résultat typé dédié au sondage (votes par choix et nombre de votants), à côté du résultat générique, sur le modèle de `wordcloudView`. La distribution générique par réponse sérialisée ne convient pas au choix multiple.
- Reconnexion : un joueur qui a déjà voté et se reconnecte voit « Vote enregistré » ; l'animateur et le grand écran qui se reconnectent pendant la révélation retrouvent la répartition.
- Aucun avertissement dans l'éditeur ou la bibliothèque pour un quiz sans question notée ; un quiz d'un seul sondage est valide et se lance normalement.

## Laissé au constructeur

- La forme exacte de la réponse (par exemple une liste d'indices, de longueur 1 en choix unique) et sa validation (indices distincts, dans les bornes).
- Le nom et le transport de l'indicateur « quiz sans question notée » vers le podium (par exemple un champ dans l'événement `podium` et dans l'état rejoué à la reconnexion).
- Le composant d'affichage de la répartition, en réutilisant si possible les barres de distribution existantes.
- La façon dont le nuage de mots est rattaché à la règle « pas de classement après lui ».
