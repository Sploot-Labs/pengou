# Partie de démonstration sans compte

Date : 2026-11-13. Statut : proposition issue de l'audit SEO du 12 novembre 2026, en attente de l'accord de l'utilisateur. Rien n'est codé.

## Intention

Tous les boutons « Lancer un quiz » du site pengou.fr mènent à `/signup`. Rien ne permet d'essayer Pengou avant d'avoir donné un nom, une adresse et un mot de passe. Or les recherches visées par le site (« kahoot gratuit sans compte », « créer un quiz interactif gratuit ») récompensent l'essai immédiat, et un concurrent se classe avec la promesse « sans création de compte ».

L'objectif est qu'un visiteur du site se retrouve, en un clic et en moins de dix secondes, dans le salon d'une vraie partie : un code à six chiffres, un QR code, et de vrais joueurs qui rejoignent depuis leur téléphone. Le site pourra alors écrire « essayez sans créer de compte » sans mentir.

L'application reste en noindex. La page qui se classe sur ces recherches vit sur pengou.fr ; l'application ne fournit que la destination du bouton.

## Parcours

Le site pose un bouton « Essayer sans compte » vers `https://app.pengou.fr/demo?from=<slug-de-page>`. L'écran `/demo` tient en une phrase, un bouton « Lancer la démonstration » et la mention des conditions d'utilisation. Le clic sur ce bouton, et lui seul, crée la partie : une simple visite de l'URL (robot, aperçu de lien dans une messagerie) ne crée rien.

Le serveur crée alors un hôte invité, lui attribue le quiz d'exemple de cinq questions et ouvre la partie. Le navigateur arrive sur `/host/:sessionId`, l'écran de salon existant, avec le code, le QR code et le lien du grand écran. Tout ce qui suit (questions, classement, podium, écran joueur) est l'application actuelle, sans variante.

Au podium, un encart propose « Créer mon compte pour faire mes propres quiz », vers `/signup?from=demo`. L'inscription mène déjà à un quiz d'exemple modifiable dans l'éditeur.

## Limites proposées

Une partie de démonstration accueille 30 joueurs au plus, la taille d'une classe. Elle joue cinq questions fixes, une par grand type (QCM, vrai ou faux, curseur, sondage, nuage de mots) : c'est le quiz d'exemple déjà livré dans `apps/server/src/example-quiz.ts`.

Elle vit une heure au plus après sa création, et s'arrête après trente minutes sans activité (le balayage existant). L'hôte invité peut la relancer tant que son accès dure, soit vingt-quatre heures, mais n'anime qu'une partie à la fois.

Rien n'est sauvegardé : pas d'éditeur, pas de bibliothèque, pas de rapport, pas d'historique. L'hôte invité, son quiz, sa partie, les pseudos et les réponses sont supprimés dans les vingt-quatre heures.

L'instance n'accepte que 20 parties de démonstration simultanées. Au-delà, l'écran `/demo` explique que la démonstration est très demandée et propose de créer un compte gratuit.

## Conception

### Un hôte invité plutôt qu'une partie sans utilisateur

La passerelle temps réel lie chaque partie à un utilisateur authentifié (`game_session.host_id`, clé étrangère vers `user`), à un workspace et à un quiz en base. La reprise après une coupure (`host:reconnect`) compare l'utilisateur de la session à l'hôte de la partie. Une partie sans utilisateur demanderait un second chemin dans toute la passerelle, la persistance et le grand écran, avec les régressions que cela suppose.

La proposition est donc de créer un vrai compte, mais invité : le plugin `anonymous` de Better Auth, présent dans la version installée, crée un utilisateur sans adresse (colonne `user.is_anonymous`) et sa session. Le cookie de session est strictement nécessaire au service demandé, il ne demande pas de bandeau de consentement. Avec ce compte, la création de partie, le salon, la reprise et le grand écran fonctionnent sans modification.

### Ce que le serveur ajoute

Une route `POST /api/demo`, protégée par le contrôle d'origine existant, crée l'invité, laisse le hook d'inscription lui créer son workspace comme pour tout compte, y copie le quiz d'exemple (`importQuiz` et `EXAMPLE_QUIZ`, déjà en place) et renvoie l'identifiant du quiz. Le client lance ensuite la partie par l'événement `host:create` habituel.

Un invité est restreint côté serveur, pas seulement dans l'interface. Les routes de l'éditeur, de la bibliothèque, des workspaces et des invitations lui répondent 403. `host:create` et `host:relaunch` n'acceptent de lui que son quiz de démonstration. Le plafond de joueurs devient le plus petit de `MAX_PLAYERS_PER_SESSION` et de `DEMO_MAX_PLAYERS` quand l'hôte est invité : la vérification existe déjà (`seatsTaken` dans `game-gateway.ts`), seule la borne change.

Un balayage périodique, sur le modèle de celui des parties inactives, supprime les invités de plus de vingt-quatre heures avec leur workspace. La suppression du workspace emporte par cascade le quiz, la partie, les joueurs et les réponses.

Quatre variables règlent la fonction : `DEMO_ENABLED` (faux par défaut, une instance auto-hébergée n'est pas concernée ; vrai sur app.pengou.fr), `DEMO_MAX_PLAYERS` (30), `DEMO_MAX_CONCURRENT` (20) et `DEMO_PER_IP_PER_HOUR` (5).

### Conditions d'utilisation

L'hôte invité utilise le service : les conditions d'utilisation s'appliquent à lui. L'écran `/demo` porte la phrase « En lançant la démonstration, vous acceptez les conditions d'utilisation », avec le lien, et le serveur enregistre la version acceptée sur le compte invité, comme pour une inscription. La case « J'ai 15 ans ou plus » est une question ouverte, plus bas.

## Risques d'abus et parades

Création en masse par un script. C'est le risque principal : chaque démonstration écrit en base et réserve un code parmi le million de codes à six chiffres. Les parades sont un budget par adresse IP (cinq démonstrations par heure, sur le modèle de `FailureBudget`, avec l'IP réelle déjà fiabilisée par `TRUSTED_PROXIES`), le plafond global de parties simultanées, la création par `POST` avec contrôle d'origine, et la purge à vingt-quatre heures. Un captcha ou une preuve de travail ne sont pas prévus en première version : ils ajouteraient un tiers ou de la friction, à l'opposé du but. Ils restent le recours si les journaux montrent un abus.

Établissement derrière une seule adresse IP. Cinq démonstrations par heure pour tout un lycée peuvent bloquer une salle de formation où vingt enseignants essaient en même temps. Le message de refus renvoie alors vers la création de compte, gratuite. La valeur est réglable.

Usage permanent sans compte. Un animateur pourrait rejouer la démonstration indéfiniment. Avec un quiz fixe de cinq questions et 30 joueurs, cet usage n'a pas d'autre valeur que l'essai : c'est acceptable.

Contenu déplacé. Le contenu de l'hôte est fixe. Les pseudos et les mots du nuage sont du texte libre, affiché seulement dans la partie concernée ; l'animateur dispose déjà de l'exclusion d'un joueur et du retrait d'un mot.

Devinette de code. Inchangé : le budget d'échecs de code par IP s'applique aux parties de démonstration comme aux autres.

## Coût serveur

Les mesures viennent des campagnes de charge du dépôt (`docs/charge/`), jouées en local sur l'image de production bridée aux limites du VPS (4 CPU, 15 Go).

Une partie de 30 joueurs coûte au plus 20 % d'un cœur pendant les réponses, pour une réponse au 95e centile de 3,5 ms (campagne du 12 novembre 2026, commit eebb6cd). Dix parties simultanées de 30 joueurs passent sans erreur (campagne du 31 octobre 2026). La mémoire du serveur reste autour de 310 Mo quelle que soit la charge.

Le plafond de 20 parties simultanées représente 600 connexions. Ce cas précis n'a pas été mesuré. Les cas voisins le couvrent largement (640 joueurs dans une seule salle, le cas le plus coûteux, passent), mais la règle du projet est de publier des chiffres mesurés : un passage « vingt parties de 30 » est à ajouter à `apps/server/charge/scenarios.mjs` et à jouer avant d'activer la fonction.

En base, une démonstration écrit moins de 200 lignes (un utilisateur, un workspace, un quiz, cinq questions, une partie, 30 joueurs et 150 réponses au plus), toutes supprimées dans les vingt-quatre heures. À 500 démonstrations par jour, le volume transitoire reste sous 100 000 lignes.

## Mesure

Le paramètre `from` du bouton du site est conservé jusqu'au compte invité, dans la colonne `user.signup_source` déjà en place. Comme les invités sont purgés, un compteur quotidien agrégé (date, provenance, démonstrations lancées, parties démarrées avec au moins un joueur) garde la mesure sans donnée personnelle. Les inscriptions qui suivent une démonstration arrivent avec `from=demo` et sortent dans l'export existant des inscriptions par provenance.

## Côté site vitrine

Le site ajoute le bouton « Essayer sans compte » et, s'il vise ces recherches, une page dédiée. Son texte doit annoncer les limites réelles : 30 joueurs, cinq questions d'exemple, rien n'est conservé, un compte gratuit pour créer ses propres quiz.

## Questions ouvertes

1. Faut-il la case « J'ai 15 ans ou plus » sur l'écran `/demo`, comme à l'inscription ? Elle a une raison juridique à l'inscription ; ici aucune donnée personnelle de l'hôte n'est collectée, mais c'est à l'utilisateur d'en décider.
2. Les valeurs proposées (30 joueurs, une heure, 20 parties simultanées, cinq démonstrations par heure et par IP) conviennent-elles ?
3. La démonstration joue-t-elle le quiz d'exemple de l'inscription, ou un quiz conçu pour l'effet de démonstration (images, questions plus ludiques) ?
4. La fonction doit-elle rester éteinte par défaut en auto-hébergement, comme proposé ?

## Découpage envisagé

Cinq lots, chacun livrable et testé seul : le compte invité (plugin, migration, restrictions des routes), la route `POST /api/demo` avec ses budgets, la purge, l'écran `/demo` avec l'encart du podium, puis le passage de charge « vingt parties de 30 » et la documentation d'exploitation.
