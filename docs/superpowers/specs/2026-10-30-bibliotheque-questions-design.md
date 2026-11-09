# Bibliothèque de quiz et de questions

Conception, 2026-10-30.

## Intention et pourquoi

Aujourd'hui, chaque quiz Pengou se construit à partir de rien. Une question
appartient à un seul quiz (clé `quizId` non nulle, suppression en cascade, voir
`packages/db/src/schema.ts`), rien ne se réutilise, et il faut connaître soi-même
les questions et leurs réponses. C'est lent, et c'est disproportionné quand on veut
juste monter un quiz pour se détendre.

La bibliothèque répond à ce besoin : un catalogue public de questions et de quiz
tout prêts, fourni par Sploot Labs avec Pengou, dans lequel n'importe quel
utilisateur pioche pour monter un quiz en quelques clics.

La vision complète comporte trois sources (le catalogue Sploot Labs, les questions
personnelles de chacun, les questions partagées par d'autres). Ce document ne couvre
que la première étape, le catalogue Sploot Labs. Les autres sont décrites plus bas
comme étapes ultérieures, pour que les choix de cette version ne les bloquent pas.

## Objectifs

- Une page « Bibliothèque » accessible depuis l'accueil, à côté de « Mes quiz »,
  avec deux onglets : « Quiz tout prêts » et « Questions ».
- Onglet « Quiz tout prêts » : une liste de quiz composés par Sploot Labs (une
  dizaine au lancement, plus selon les bases récupérées). « Dupliquer » crée une
  copie du quiz dans l'espace de travail courant de l'utilisateur, puis ouvre
  l'éditeur sur cette copie.
- Onglet « Questions » : filtres par thème, difficulté, langue et public visé. On
  coche des questions une par une, ou on tire au hasard un nombre de questions
  correspondant aux filtres en cours. Les questions s'accumulent dans une sélection
  visible sur le côté. Valider demande un titre, crée un nouveau quiz contenant la
  sélection, puis ouvre l'éditeur.
- Le catalogue contient quelques centaines de questions au lancement, issues de
  bases de questions sous licence ouverte.
- Le catalogue est décrit par des fichiers JSON livrés dans le dépôt. Chaque
  instance peut ajouter ses propres fichiers.
- Les thèmes forment une liste fixe fournie par Sploot Labs, que chaque instance
  peut adapter.

## Non-objectifs (étapes ultérieures)

- Bibliothèque personnelle : toutes les questions des quiz existants d'un
  utilisateur y apparaîtraient automatiquement. Leur classement passerait d'abord
  par un formulaire de saisie manuelle, puis éventuellement par un classement
  automatique par IA.
- Partage de questions et de quiz au sein d'une organisation ou vers l'extérieur,
  avec un réglage d'espace de travail qui autorise ou interdit le partage public.
- Réglage d'instance qui autorise ou interdit aux utilisateurs de proposer des
  questions au catalogue public.
- Écran d'administration du catalogue dans Pengou (ajout, correction, retrait).
- Ajouter une sélection à un quiz existant, ou ouvrir la bibliothèque depuis
  l'éditeur sous forme de panneau. Seule la création d'un nouveau quiz est prévue.

## Anti-objectifs (ce qui ferait échouer la fonctionnalité même si elle marche)

- Qu'une modification faite par l'utilisateur sur un quiz ou une question repris
  remonte dans le catalogue, ou qu'une mise à jour du catalogue modifie un quiz
  déjà créé. Tout ce qui sort de la bibliothèque est une copie qui appartient à
  l'utilisateur.
- Qu'une partie passée ou son rapport change parce que le catalogue a changé. Les
  réponses enregistrées (`answer_record.questionId`) pointent vers les lignes
  `question` du quiz copié, jamais vers le catalogue.
- Redistribuer des questions en violation de la licence de leur source, ou sans
  en citer l'origine quand la licence l'exige.
- Faire fuiter les données d'un espace de travail vers un autre. Le catalogue est
  commun à toute l'instance, mais les copies vivent dans le tenant de l'utilisateur
  et restent soumises à la RLS.
- Bloquer les étapes ultérieures : le modèle de données du catalogue (thème,
  difficulté, langue, public, provenance) doit pouvoir accueillir plus tard des
  questions personnelles ou partagées sans tout refaire.

## Contraintes

- Pile existante : Fastify 5 et Drizzle sur PostgreSQL côté serveur, React 19 et
  react-router 7 côté web, monorepo pnpm. Les types de question et leur validation
  vivent dans `packages/quiz` (`mcq`, `truefalse`, `text`, `slider`).
- Multi-tenant sous RLS (`0015_rls.sql`, `0017_rls_workspaces.sql`). Le quiz créé
  depuis la bibliothèque appartient au tenant courant et à l'utilisateur qui le
  crée (`ownerId`), exactement comme un quiz créé à la main. Un simple membre le
  voit donc dans « Mes quiz », et les admins et le propriétaire de l'espace aussi.
- Tout utilisateur connecté peut consulter le catalogue et en tirer des quiz,
  quel que soit son rôle dans l'espace de travail.
- Chaque question importée doit passer la même validation que les questions
  saisies dans l'éditeur (payload par type, voir `packages/quiz/src/registry.ts`).
  Un fichier invalide est rejeté avec un message clair, plutôt qu'importé à moitié.
- Pengou est sous Apache 2.0, alors que les bases de questions ouvertes sont
  souvent sous d'autres licences (CC BY-SA par exemple). Les données du catalogue
  vivent dans un dossier à part du dépôt, avec leur propre fichier de licence par
  source. Chaque question et chaque quiz du catalogue garde la trace de sa source
  (voir plus bas l'attribution sur les copies).
- Le catalogue des fichiers est livré avec Pengou, de sorte qu'une instance
  auto-hébergée l'a d'office.
- CI : `pnpm lint` et `pnpm typecheck` doivent passer. Ne jamais lancer
  `biome format --write` sur le dépôt.

## Ce qui a été décidé

- Le catalogue est alimenté par Sploot Labs à partir de bases de questions ouvertes,
  au format JSON versionné dans le dépôt. L'écran d'administration viendra plus tard.
- Une instance peut ajouter ses propres fichiers JSON au catalogue, et adapter la
  liste des thèmes.
- Le classement porte sur quatre critères : thème (liste fixe), difficulté, langue,
  public visé (enfants, adultes, tous).
- Trois façons de composer : dupliquer un quiz tout prêt, choisir des questions une
  par une, tirer au hasard selon les filtres. Les deux dernières se combinent dans
  une même sélection.
- La bibliothèque est une page à part. Valider une sélection crée toujours un
  nouveau quiz.
- Tout ce qui sort du catalogue est copié dans le tenant de l'utilisateur.
- Le catalogue est stocké en base, dans des tables communes à toute l'instance (hors
  tenant), parce que d'autres contenus viendront s'y ajouter plus tard (propositions
  des utilisateurs, partage). Les fichiers JSON restent la source du catalogue livré
  et du catalogue d'instance : une synchronisation au démarrage du serveur les
  recopie en base, avec des identifiants stables tirés des fichiers. Chaque ligne
  retient son origine (livré ou instance) pour que les contenus ajoutés plus tard
  par d'autres voies ne soient jamais touchés par cette synchronisation.
- La source et la licence suivent la copie : une question ou un quiz copié depuis
  le catalogue garde sa provenance (nom de la source, licence, lien), y compris
  après modification par l'utilisateur, puisque les licences de type CC BY-SA
  imposent l'attribution sur les œuvres dérivées. Cela demande d'ajouter cette
  information au modèle `question` (et `quiz` pour un quiz dupliqué). La mention
  s'affiche dans la bibliothèque et dans l'éditeur, pas pendant la partie (ni
  grand écran, ni téléphone, ni rapport).

## Choix du concepteur, à vérifier

Ces points n'ont pas été tranchés avec Julien. Je les ai fixés pour que le
document soit complet, et ils restent révisables.

- Les quatre types de question existants sont acceptés dans le catalogue. En
  pratique, la plupart des bases ouvertes fournissent du QCM et du vrai/faux.
- Pas de média dans le catalogue pour cette version. La colonne `media` des
  questions copiées reste vide. Les images posent des questions de licence et
  d'hébergement qu'on traitera avec l'écran d'administration.
- Les temps de réponse et de lecture d'une question du catalogue sont optionnels
  dans le JSON. À défaut, les valeurs par défaut actuelles du schéma s'appliquent.
- Le tirage au hasard ne propose pas une question déjà présente dans la sélection.
  S'il y a moins de questions disponibles que demandé, il en ajoute autant qu'il
  peut et le dit.
- Les fichiers ajoutés par une instance se trouvent dans un dossier désigné par
  une variable d'environnement. Si un identifiant de question ou de quiz est en
  conflit avec le catalogue livré, l'import échoue avec un message qui nomme le
  conflit.
- Politique d'erreur à l'import. Le catalogue livré est validé par un test en CI,
  il ne peut donc pas arriver invalide sur une instance. Un fichier d'instance
  invalide ou en conflit est écarté en entier (rien de sa nouvelle version n'est
  importé), l'erreur est journalisée de façon visible, et le reste du catalogue est
  servi. Pengou démarre quand même. Ce qui avait été importé de ce fichier lors d'une
  synchronisation précédente reste en place, pour qu'une faute de frappe ne vide
  pas le catalogue de l'instance.
- Une question ou un quiz qui disparaît des fichiers est retiré de la base à la
  synchronisation suivante. Les copies déjà faites ne sont pas touchées, puisqu'elles
  ne pointent pas vers le catalogue.
- Adaptation des thèmes. Les thèmes sont référencés par un identifiant stable,
  avec un libellé. Une instance peut ajouter des thèmes, changer le libellé d'un
  thème livré, ou en masquer un. Elle ne peut pas le supprimer. Les questions et
  quiz d'un thème masqué n'apparaissent plus dans la bibliothèque, sans faire
  échouer l'import.

## Laissé au concepteur du plan

- Le format exact des fichiers JSON (questions, quiz tout prêts, thèmes, sources et
  licences) et son schéma de validation.
- Le détail des tables du catalogue et de la synchronisation, dans le cadre fixé
  plus haut (stockage en base, synchronisation au démarrage).
- Le choix des bases sources et leur conversion au format JSON, à condition que la
  licence permette la redistribution et que les questions soient classées selon les
  quatre critères. OpenQuizzDB (français) et Open Trivia DB (anglais) sont des
  candidates, sous réserve de vérifier leurs licences.
- Les routes de l'API, la pagination et la recherche dans l'onglet « Questions ».
- La présentation détaillée des deux onglets, dans le style visuel actuel de
  l'application. Des maquettes de principe ont été validées : filtres en haut,
  cartes de quiz avec un bouton « Dupliquer », liste de questions à cocher avec un
  champ « Tirer N questions » et la sélection sur le côté.
- La persistance de la sélection en cours (en mémoire de la page suffit a priori).
