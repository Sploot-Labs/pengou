# Relancer une partie depuis le podium

Conception, 2026-10-24.

## Intention et pourquoi

Aujourd'hui, quand une partie se termine, tout le monde est bloqué sur le podium.
Pour enchaîner une autre partie, l'animateur doit repartir de l'accueil, relancer
un quiz, récupérer un nouveau PIN, et chaque joueur doit rescanner ou retaper ce
code et son pseudo. C'est un mur entre deux parties, alors que le cas d'usage
réel (soirée de quiz, classe, animation) consiste justement à enchaîner.

L'objectif : depuis le podium, l'animateur choisit un quiz et relance, et tous les
participants déjà présents (joueurs sur téléphone et grand écran) basculent
automatiquement dans la nouvelle partie, en lobby, sans rien retaper.

Un premier volet, plus petit et indépendant, est déjà livré : un bouton
« Rejoindre une autre partie » sur le podium du téléphone, qui ramène le joueur
vers /join pour saisir un nouveau code. Ce document concerne le second volet, la
relance pilotée par l'animateur.

## Objectifs

- L'animateur, au podium, choisit n'importe quel quiz de son espace et relance la
  partie en un geste.
- Les joueurs connectés basculent seuls dans la nouvelle partie, en lobby, sans
  ressaisir ni code ni pseudo (leur pseudo est repris tel quel).
- Le grand écran bascule seul sur la nouvelle partie et affiche le nouveau PIN,
  pour que d'éventuels nouveaux joueurs puissent rejoindre.
- La nouvelle partie est une partie neuve à part entière : nouvelle session en
  base, nouveau PIN, scores remis à zéro, rapport propre (aucune réponse de
  l'ancienne partie mélangée à la nouvelle).

## Non-objectifs

- Conserver les scores d'une partie à l'autre, ou tenir un cumul multi-parties.
- Rejouer exactement les mêmes joueurs à l'identique : on migre ceux qui sont
  connectés au moment de la relance, pas plus.
- Changer le mode d'enchaînement automatique des étapes (host:setAuto) ou toute
  autre mécanique de jeu existante.

## Anti-objectifs (ce qui ferait échouer la fonctionnalité même si ça marche)

- Faire fuiter une bonne réponse pendant la bascule, ou laisser un joueur arriver
  ailleurs qu'en phase lobby de la nouvelle partie.
- Mélanger, en base ou en mémoire, l'état de l'ancienne et de la nouvelle partie
  (réponses, scores, PIN, jetons), ou corrompre le rapport d'une des deux.
- Laisser un participant dans un état incohérent : écran figé sur l'ancien
  podium, socket rattachée à une room morte, identité périmée en localStorage.
- Permettre à quelqu'un d'autre que l'hôte légitime de déclencher une relance.

## Contraintes (invariants du dépôt à respecter)

- Le serveur est seul maître de l'état et du temps. Aucune donnée de timing ni de
  correction venant du client. La bonne réponse n'existe côté client qu'après
  question:reveal (anti-triche, voir engine.ts et game-gateway.ts).
- Multi-tenant sous RLS : la nouvelle session se crée dans le contexte tenant de
  l'hôte, avec la même résolution rôle/owner que host:create (owner/admin peut
  lancer n'importe quel quiz du tenant, member seulement les siens).
- L'id de session est unifié moteur↔base (un seul id partout). Le PIN est généré
  avant la création de la ligne game_session (voir host:create).
- Les écrans temps réel (PlayerLive, HostLive, BigScreen) montent leurs
  abonnements une seule fois et figent leur identité au montage. On ne mute pas
  cette identité en place ; on adopte une nouvelle partie par un remontage propre.
- Le grand écran lit son jeton d'affichage dans l'URL et screen:join est à usage
  unique. Il n'y a pas de screen:reconnect câblé côté client aujourd'hui. La
  bascule du grand écran passe donc par un nouveau jeton porté dans une nouvelle
  URL, jamais par une mutation du jeton courant.
- Le fil Socket.IO est typé via les contrats partagés (contracts.ts) ; tout
  nouvel événement y est déclaré.

## Le mécanisme décidé

Principe directeur : réutiliser au maximum ce qui existe déjà. Créer une nouvelle
partie, c'est déjà ce que fait host:create. Entrer dans une partie avec une
identité connue, c'est déjà ce que font player:reconnect, host:reconnect et
screen:join. La relance se contente d'orchestrer : elle crée la partie neuve,
fabrique pour chaque participant connecté une identité valide dans cette nouvelle
partie, puis laisse chaque client adopter cette identité via le chemin de
(re)connexion existant.

### Côté serveur : un seul nouvel événement, host:relaunch

Nouvel événement hôte `host:relaunch { quizId }`, réservé à l'hôte de la session
courante, et réservé à la phase podium (voir « Décisions réglées »). Déroulé :

1. Vérifier que l'appelant est bien l'hôte de la session courante (requireHost),
   et que l'ancienne session est bien en phase podium ; sinon, refuser sans rien
   migrer. Récupérer l'ancienne session + sa meta.
2. Réauthentifier via la session Better Auth du handshake et résoudre
   tenant/rôle/owner exactement comme host:create, puis charger les questions du
   quiz demandé sous RLS. Un quiz d'un autre tenant « n'existe pas ». Cette partie
   est factorisée depuis host:create (helper commun créant la session neuve et sa
   meta) pour ne pas diverger.
3. Créer la nouvelle session : nouveau PIN unique, nouvelle ligne game_session,
   session moteur, SessionMeta, entrée pinToSessionId. Identique à host:create.
4. Migrer les participants connectés de l'ancienne room. On énumère les sockets
   réellement présentes dans l'ancienne room (fetchSockets) : ce sont exactement
   les participants connectés.
   - Pour chaque socket joueur : lire son pseudo depuis l'ancienne session
     (socket.data.playerId → players[id].nickname), créer un joueur neuf dans la
     nouvelle session (engine.addPlayer, nouveau joinToken), le persister
     (addSessionPlayer), renseigner playerDbIds de la nouvelle meta, puis émettre
     à CETTE socket seulement `session:relaunched` avec sa nouvelle identité
     joueur (pin, playerId, joinToken, nickname).
   - Pour chaque socket grand écran : générer un nouveau displayToken rattaché à
     la nouvelle session (screenTokenToSessionId), puis émettre `session:relaunched`
     à cette socket avec la variante écran (sessionId, displayToken, pin).
   - La socket hôte (l'appelante) reçoit l'ack de succès { sessionId, pin } pour
     naviguer. Le serveur ne déplace aucune socket : chaque client (hôte, joueurs,
     grand écran) effectue un rechargement complet et rejoint la nouvelle room par
     son chemin de (re)connexion habituel (voir « remontage » plus bas).
   - Chaque participant est migré en best-effort, indépendamment des autres : si
     la migration d'un participant échoue (erreur DB, socket à l'état inattendu),
     on l'ignore et on continue avec les autres. Un participant non migré reste
     simplement sur l'ancien podium ; la nouvelle partie démarre quand même et
     l'hôte navigue. On n'annule jamais une relance déjà engagée.
5. L'ancienne partie reste au podium et sera évincée par le mécanisme d'éviction
   différée déjà en place (PODIUM_EVICTION_DELAY). On ne force rien de plus : la
   nouvelle partie a son propre PIN, l'ancien mapping PIN reste cohérent jusqu'à
   l'éviction.

Les joueurs et écrans déconnectés au moment de la relance ne sont pas migrés (pas
de socket vivante, donc pas d'identité à leur pousser). C'est une conséquence
assumée : ils étaient déjà hors de la partie.

Aucun invariant anti-triche n'est touché : la nouvelle session démarre en lobby,
sans question courante, donc rien à révéler ni à projeter.

### Côté serveur : adoption par le chemin de (re)connexion existant

Rien de nouveau ici, c'est le point clé. Une fois qu'un client a reçu sa nouvelle
identité et se présente à nouveau (player:reconnect avec le nouveau pin+joinToken,
screen:join avec le nouveau jeton, host:reconnect avec le nouvel id), le serveur
le rattache à la nouvelle room et lui envoie le snapshot de lobby par les chemins
déjà écrits et testés. On ne fabrique pas d'état initial neuf.

### Côté client : adopter la nouvelle partie

- PlayerLive s'abonne à `session:relaunched` (variante joueur). À réception :
  enregistre la nouvelle identité (savePlayerSession) puis provoque un remontage
  propre de l'écran de jeu sur la nouvelle partie. Au remontage, le chemin normal
  (player:reconnect avec la nouvelle identité) le pose en lobby de la nouvelle
  partie. On ne mute pas l'identité figée au montage (voir contraintes).
- BigScreen s'abonne à `session:relaunched` (variante écran). À réception :
  bascule vers l'URL grand écran portant le nouveau jeton, ce qui remonte l'écran
  et refait screen:join sur la nouvelle session. Cohérent avec le modèle actuel
  (jeton dans l'URL, join à usage unique).
- HostLive, au podium, affiche un sélecteur de quiz et un bouton de relance.
  Au clic : emitAck('host:relaunch', { quizId }), puis navigation vers
  /host/:nouvelId pour repartir sur la nouvelle partie en lobby.
- contracts.ts : déclarer le(s) payload(s) de `session:relaunched`.

### Pourquoi le remontage plutôt que la mutation en place

Les trois écrans figent délibérément leur identité et leurs abonnements au
montage (effet unique, closures sur l'identité initiale). Muter l'identité en
place laisserait des closures périmées (par exemple le filtrage du classement sur
l'ancien playerId). Le remontage réutilise la machinerie de reconnexion déjà
durcie et testée, au prix d'une brève réinitialisation locale de l'écran. C'est
exactement le modèle que suit déjà le grand écran après une coupure réseau.

## Décisions réglées (appels du concepteur)

Trois points soulevés en relecture, tranchés ici pour que le plan ne devine pas :

- Relance réservée à la phase podium. Côté serveur, host:relaunch refuse si
  l'ancienne session n'est pas au podium ; côté client, le contrôle de relance
  n'existe que dans PodiumView. Raison : au podium, doAdvance a déjà annulé tous
  les minuteurs autoritatifs (lecture/question/avance) et planifié l'éviction, la
  session est donc inerte. Autoriser la relance en pleine partie laisserait
  l'ancienne session continuer à révéler et avancer, et à diffuser dans une room
  que l'hôte vient d'abandonner, ce qui violerait les anti-objectifs.
- Migration best-effort par participant (voir étape 4). Un échec de migration
  d'un participant ne fait pas échouer la relance ni les autres migrations. Une
  fois la nouvelle session créée, il n'y a pas de rollback : ce choix évite une
  demi-session sans chemin de nettoyage. Les échecs pré-vol (quiz invalide, droits
  insuffisants), eux, surviennent avant toute création et ne bougent personne.
- Remontage par rechargement complet pour les trois rôles, et le serveur ne
  déplace donc aucune socket. L'hôte recharge vers /host/:nouvelId (host:reconnect
  le repose en lobby), les joueurs rechargent /play (player:reconnect avec leur
  nouvelle identité), le grand écran recharge vers son URL portant le nouveau
  jeton (screen:join). Conséquence assumée : après rechargement, l'hôte ne revient
  pas sur l'ancien podium (l'ancienne session s'évince seule au bout de
  PODIUM_EVICTION_DELAY). C'est le modèle de reconnexion déjà en place.

## Ce qui est laissé au réalisateur du plan

- Le mécanisme exact de remontage par rôle (clé de route sur l'id de session,
  navigation avec state, ou rechargement vers l'URL porteuse d'identité). Pour les
  joueurs et le grand écran, l'identité vit respectivement en localStorage et dans
  l'URL, donc un remontage via cette URL/identité est direct. Pour l'hôte,
  préférer une solution sans perdre le titre du quiz si c'est simple, sinon
  host:reconnect reconstitue le PIN et la phase.
- La source de la liste de quiz pour le sélecteur du podium : réutiliser la même
  que les cartes de quiz de l'accueil (Home), pas une nouvelle route.
- L'UI du sélecteur au podium de HostLive (liste, état de chargement, erreur) et
  son intégration visuelle avec PodiumView.
- La factorisation précise de host:create en un helper partagé avec host:relaunch,
  sans changer le comportement de host:create.
- La gestion fine des erreurs (quiz invalide, droits insuffisants) : l'animateur
  reste au podium avec un message, les participants ne bougent pas.
- Le sort documenté des participants déconnectés (non migrés) et d'un joueur qui
  se reconnecterait à l'ancien PIN pendant la fenêtre d'éviction.

## Approche de test

- Moteur : inchangé (la relance n'ajoute pas de logique de jeu ; elle réutilise
  createSession/addPlayer).
- Passerelle (game-gateway) : tests d'intégration Socket.IO comme pour host:create
  et la reconnexion. Vérifier qu'après host:relaunch une nouvelle session existe
  avec un PIN distinct, que chaque joueur connecté reçoit session:relaunched avec
  une identité valide dans la nouvelle session, que le grand écran reçoit un
  nouveau jeton, que l'ancienne session reste au podium, et que la relance est
  refusée à un non-hôte.
- Web : tests testing-library par écran. PlayerLive adopte la nouvelle identité et
  revient en lobby à réception de session:relaunched. BigScreen bascule sur la
  nouvelle URL. HostLive relance via le sélecteur et navigue vers la nouvelle
  partie.
- Non-régression : les suites existantes (host:create, reconnexions joueur/hôte/
  écran, enchaînement automatique) restent vertes.
