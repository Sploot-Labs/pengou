# Nuage de mots : conception

Date : 2026-11-01. Premier des trois nouveaux types de questions prévus (nuage de mots, questions avec images, blind test musical). Les deux autres feront l'objet de leurs propres documents.

## Intention

Pengou sert autant aux soirées quiz qu'à l'animation de réunion. Le nuage de mots répond au second usage : récolter les idées d'une salle plutôt que vérifier une bonne réponse. L'animateur pose une question ouverte (« Quel mot résume votre trimestre ? »), chaque participant propose des mots courts depuis son téléphone, et le grand écran affiche un nuage qui se construit en direct, les mots les plus proposés apparaissant en plus grand. À la fin, l'animateur exporte ce qui a été récolté.

La valeur tient au direct : la salle voit ses idées apparaître et grossir pendant que le chrono tourne. Un nuage affiché seulement à la fin raterait l'effet recherché.

## Objectifs

Un nouveau type de question `wordcloud`, créable dans l'éditeur au même titre que QCM, vrai/faux, texte et curseur, et mélangeable avec eux dans un même quiz.

Le participant envoie ses mots un par un, au fil de ses idées, tant que le temps n'est pas écoulé. Chaque mot est court (25 caractères au plus). Il voit sur son téléphone la liste de ses propres mots envoyés, mais pas le nuage collectif, pour ne pas être influencé.

Le grand écran affiche le nuage en direct pendant la question : taille d'un mot proportionnelle à son nombre d'occurrences, avec le nombre de participants ayant proposé au moins un mot et le nombre total de mots reçus.

Les variantes de casse et d'accents sont fusionnées (« Équipe », « equipe » et « EQUIPE » comptent comme un seul mot), en réutilisant `normalizeText` de `packages/quiz/src/text.ts`. Le mot affiché est la graphie la plus fréquente parmi les variantes fusionnées.

L'animateur peut retirer un mot du nuage en direct depuis son écran de contrôle (`HostLive`). Un mot retiré disparaît immédiatement du grand écran et reste bloqué jusqu'à la fin de la question : si quelqu'un le renvoie, il n'est pas affiché.

L'animateur peut exporter les résultats : chaque mot avec son nombre d'occurrences, depuis le rapport de partie.

## Non-objectifs

Pas de bonne réponse ni de points. Une question nuage de mots ne modifie pas le classement et n'est pas comptée comme une question ratée dans le rapport ou l'export.

Pas de nuage sur le téléphone du participant, ni pendant ni après la question.

Pas de filtre automatique de mots grossiers dans cette version : la modération est manuelle, par l'animateur.

Pas d'export du nuage en image.

Pas de changement de comportement pour les autres types de questions (voir la contrainte de performance ci-dessous).

## Anti-objectifs

Un nuage qui saccade ou un serveur qui ralentit dès qu'une salle nombreuse envoie beaucoup de mots en même temps.

Un mot retiré par l'animateur qui réapparaît, que ce soit parce qu'il a été renvoyé, après une reconnexion du grand écran ou dans l'export.

Une question nuage de mots qui se clôt toute seule parce que tout le monde a envoyé un premier mot (voir l'auto-révélation ci-dessous).

## Contraintes

La diffusion en direct des réponses est réservée à ce type. Les autres types gardent le fonctionnement actuel, où le serveur conserve les réponses pour lui et ne les diffuse qu'à la révélation. C'est une exigence de l'utilisateur pour tenir la charge en cas de fort volume, et c'est aussi la garantie anti-triche existante (la répartition des QCM ne doit pas fuiter pendant la question).

La diffusion du nuage est agrégée et cadencée : le serveur n'émet pas un événement par mot reçu mais l'état agrégé du nuage à intervalle court, de l'ordre de 500 ms, et seulement s'il a changé. Choix du concepteur, ajustable par le constructeur.

Le schéma actuel impose une réponse par joueur et par question (refus dans `submitAnswer`, `packages/game/src/engine.ts:240`, et index unique `answer_session_question_player_uidx` sur `answer_record`). Ce verrou reste en place : pour ce type, chaque nouveau mot s'ajoute à la réponse existante du participant (`{ words: [...] }`) au lieu d'être refusé. Choix du concepteur.

Le dépôt n'est pas formaté par Biome : ne pas lancer `biome format --write`. `pnpm lint` et `pnpm typecheck` doivent passer, la CI les bloque.

## État actuel utile

Les types de questions passent par le registre `packages/quiz/src/registry.ts`. Chaque type déclare `validatePayload`, `validateAnswer`, `playerView`, `isCorrect` et `score` (`packages/quiz/src/types.ts`).

Le type est aussi un enum Postgres `question_type` (`packages/db/src/schema.ts:11`), utilisé par `question` et `library_question`. Ajouter `wordcloud` demande une migration Drizzle.

Le grand écran et l'hôte reçoivent `screen:progress` (compteur répondu/total) à chaque réponse acceptée, dans le handler `player:answer` de `apps/server/src/game-gateway.ts`, via la room `viewersRoomName`. La passerelle limite aussi chaque socket à 240 événements par fenêtre de 10 s, largement suffisant pour des envois de mots. Juste après, la passerelle déclenche une auto-révélation dès que tous les joueurs connectés ont répondu.

À la révélation, `questionResult` (`engine.ts:362`) construit une répartition en regroupant les réponses par `JSON.stringify(answer)`, puis `apps/web/src/realtime/distribution.ts` la décode par type. Les réponses sont écrites en base à la révélation par `persistRoundAnswers` (`game-gateway.ts:428`).

Le rapport de partie et son export CSV (`apps/server/src/routes/sessions.ts`, `packages/db/src/repos/reports.ts`) comptent les réponses correctes via `answer_record.is_correct`.

L'éditeur (`apps/web/src/screens/HostEditor.tsx`), l'écran joueur (`PlayerLive.tsx`), le grand écran (`BigScreen.tsx`), l'écran hôte (`HostLive.tsx`) et l'aperçu de bibliothèque (`LibraryPreview.tsx`) ont chacun des aiguillages par type à compléter.

## Comportement attendu, de bout en bout

Dans l'éditeur, l'animateur choisit « Nuage de mots », saisit l'énoncé et le temps imparti. Il n'y a pas de réponses à saisir. Le payload de question est vide ou presque ; un nombre maximal de mots par participant peut y figurer si le constructeur le juge utile (voir plus bas).

Pendant la phase de lecture, rien ne change par rapport aux autres types.

Pendant la question, le téléphone affiche un champ et un bouton « Envoyer ». Chaque envoi part au serveur, s'ajoute aux mots du participant et vide le champ ; le mot rejoint la liste « Tes idées envoyées ». Un mot vide, trop long ou déjà envoyé par ce même participant (après normalisation) est refusé avec un message clair.

Côté serveur, pour ce type uniquement, `submitAnswer` accepte des envois successifs du même joueur. Le premier envoi fixe `timeMs`. L'auto-révélation « tous les joueurs ont répondu » est désactivée pour ce type : la question se termine au chrono ou par l'animateur. Le nuage agrégé est diffusé par un nouvel événement dédié (par exemple `wordcloud:update`), en plus du `screen:progress` habituel, au grand écran et à l'hôte seulement, via la room existante `viewersRoomName` de `apps/server/src/game-gateway.ts` (introduite pour `screen:progress` par le chantier de tenue en charge). Les téléphones ne reçoivent jamais le nuage, ni pour l'affichage ni dans les données réseau, ce qui sert à la fois la consigne « ne pas influencer » et la charge. Choix du concepteur.

Un mot retiré par l'animateur puis renvoyé par un participant est accepté sans message (il rejoint sa liste personnelle), mais il n'est ni affiché dans le nuage ni compté dans « mots reçus ». Les compteurs du grand écran reflètent ce qui est visible. Choix du concepteur.

Sur `HostLive`, l'animateur voit la liste des mots agrégés avec leurs occurrences et un bouton pour retirer chacun. Le retrait passe par un nouvel événement hôte (par exemple `host:wordcloudRemove`), réservé à la socket hôte, enregistré dans l'état du moteur pour survivre à un redémarrage et à une reconnexion, puis suivi d'une diffusion immédiate du nuage.

À la révélation, le grand écran fige le nuage final (sans les mots retirés). La répartition envoyée par `questionResult` pour ce type est la liste agrégée des mots et de leurs occurrences, pas un regroupement par réponse brute. Le classement qui suit est inchangé puisqu'aucun point n'est attribué.

À la reconnexion d'un grand écran ou de l'hôte pendant ou après la question, l'état courant du nuage lui est renvoyé, comme c'est déjà le cas pour `question:show` et `question:reveal`.

## Persistance et rapport

Chaque participant a un seul `answer_record` pour la question, avec `answer = { words: [...] }`, `is_correct = false` et `points = 0`. Les mots retirés par l'animateur sont conservés dans l'état moteur, et la liste des mots retirés est persistée avec la session pour que l'export les exclue. Ce stockage ne peut pas être `engine_state`, remis à null au podium (`persistent-store.ts`, `evictSession` dans `engine.ts`) : l'export ne verrait plus la liste. Il faut un stockage durable, colonne ou table dédiée, au choix du constructeur.

Le rapport et le CSV sortent les questions nuage de mots des statistiques de jeu, côté joueur comme côté question, pour qu'elles ne passent pas pour des échecs. Côté joueur, « réponses données » et « réponses correctes » ne comptent que les questions notées (filtre sur `question.type` dans les deux requêtes de `packages/db/src/repos/reports.ts`). Côté question, la ligne d'un nuage de mots affiche le nombre de participants et de mots reçus, et laisse vides les colonnes « réponses correctes » et « temps moyen ». Choix du concepteur. L'export CSV ajoute une section par question nuage de mots : une ligne par mot (graphie affichée), avec son nombre d'occurrences, triée par occurrences décroissantes, sans les mots retirés.

La page « rapport de partie » de l'application (`apps/web/src/screens/SessionReport.tsx`) affiche, pour chaque question nuage de mots, ses quatre mots les plus proposés avec leur nombre d'occurrences, mots retirés exclus. La liste complète reste dans l'export CSV. Décision de l'utilisateur. En cas d'égalité au quatrième rang, l'ordre alphabétique départage (choix du concepteur).

## Laissé au constructeur

La forme exacte des nouveaux événements Socket.IO et du payload de question, la bibliothèque ou l'algorithme de disposition du nuage (une disposition simple en flux, tailles par paliers, est acceptable pour une première version), la cadence exacte de diffusion, un éventuel plafond de mots par participant pour borner le volume (une valeur de l'ordre de 10 à 20 paraît raisonnable), et la forme visuelle finale dans le respect des thèmes existants (`apps/web/src/theme/`).

## Maquette

Une maquette basse fidélité validée en séance (grand écran et téléphone) se trouve dans `.superpowers/brainstorm/` (non versionné). Elle montre le nuage en direct avec le compteur de participants et de mots, et côté téléphone le champ d'envoi et la liste des mots déjà envoyés.
