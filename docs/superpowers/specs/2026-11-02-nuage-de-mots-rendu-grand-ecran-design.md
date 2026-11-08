# Nuage de mots, rendu grand écran : conception

Date : 2026-11-02. Suite du document `2026-11-01-nuage-de-mots-design.md`, qui a livré le type de question `wordcloud`. Celui-ci ne touche qu'au rendu visuel du nuage sur le grand écran.

## Intention

Testé sur grand écran, le nuage actuel déçoit : une suite de mots de la même couleur, en lignes centrées, où seule la taille varie (`apps/web/src/ui/WordCloud.tsx`, cinq paliers de police, aucune animation). L'utilisateur s'attendait à un vrai nuage : des mots dans plusieurs sens, de couleurs et de tailles différentes, qui donnent envie de regarder l'écran.

La valeur du nuage tient au direct (voir le document d'origine) : la salle voit ses idées apparaître et grossir. Le nouveau rendu doit rendre ce direct spectaculaire et lisible de loin, puis offrir un vrai moment de conclusion à la fin du chrono.

## Direction retenue

Parmi trois directions maquettées (nuage typographique, étiquettes de couleur, affiche), l'utilisateur a choisi le nuage typographique. Les maquettes animées validées sont dans `.superpowers/brainstorm/114585-1793607188/content/` (non versionné) : `directions-nuage.html` (direction A, première option) et surtout `nuage-a-fin.html`, qui montre la version retenue avec son moment de fin. Le code de ces maquettes est jetable mais sert de référence de rendu et de rythme.

## Objectifs

Pendant la question, le grand écran affiche un nuage dense, centré, dont les mots sont placés en spirale autour du centre (le plus cité au milieu, les autres autour), dans le cadre disponible sous l'énoncé et au-dessus de la ligne de compteurs.

Les mots sont dans plusieurs sens : horizontaux pour la plupart, verticaux (rotation de -90°) pour environ trois sur dix. L'orientation d'un mot est fixée une fois pour toutes pendant la question : un mot ne pivote jamais. Seul le tout premier mot affiché est forcé à l'horizontale, pour que le nuage démarre sur un mot lisible au centre. Choix du concepteur.

Chaque mot a sa couleur, prise dans la palette banquise du thème `scene` (cyan, violet, corail, jaune, menthe, rose, glace ; voir `apps/web/src/theme/themes.css`), avec des teintes assez claires pour un contraste suffisant sur le fond nuit polaire. La couleur et l'orientation d'un mot sont dérivées de sa clé de normalisation (`key`), donc stables pendant toute la question et identiques après une reconnexion du grand écran.

La taille d'un mot croît continûment avec son nombre d'occurrences (et non plus par cinq paliers), avec un minimum lisible au fond d'une salle. Dans la maquette : taille proportionnelle à la racine carrée du rapport au mot le plus cité. Un mot très long est réduit pour tenir dans la largeur.

Le mot en tête porte un halo lumineux de sa couleur. Les mots peu cités (moins d'un quart des occurrences du premier, dès que celui-ci a quelques occurrences) sont légèrement atténués pour ne pas brouiller la lecture.

Le fond garde le dégradé nuit polaire du thème `scene`, avec un léger scintillement d'étoiles en arrière-plan.

## Mouvement pendant la question

Un nouveau mot apparaît en éclosant depuis rien, avec un léger rebond (environ 0,6 s, courbe `--ease-spring` des tokens de mouvement).

Quand un mot reçoit une occurrence de plus, il pulse brièvement (grossissement et léger éclat, environ 0,45 s) puis s'installe à sa nouvelle taille par une transition douce.

Les mots déjà posés restent à leur place autant que possible : à chaque mise à jour, un mot garde sa position précédente si elle est encore libre, et n'est replacé (par une transition glissée) que s'il entre en collision. La salle ne doit jamais voir tout le nuage se réarranger d'un coup.

Quand un autre mot prend la tête en cours de question, il n'est pas ramené au centre : il grossit là où il est, en ne glissant que si sa nouvelle taille le fait entrer en collision. Le centre n'est garanti qu'au premier placement. Choix du concepteur, qui privilégie la stabilité.

## Moment de fin du chrono

À la révélation (phase `reveal` de `BigScreen`, qui reste affichée jusqu'à la question suivante pour ce type), le nuage se fige dans sa dernière disposition. Il n'est pas remplacé par une liste : la salle garde ses repères.

Tous les mots s'assombrissent nettement (dans la maquette, opacité vers 0,16 et couleurs désaturées), sauf les quatre premiers, qui restent allumés, grossissent légèrement (environ 10 %) et prennent le halo du mot de tête.

Une pastille apparaît ensuite à côté de chacun de ces quatre mots : un rond de la couleur du mot avec son rang, suivi du nombre d'occurrences (« 12 fois »). Les pastilles arrivent l'une après l'autre, de la quatrième à la première, à environ une demi-seconde d'intervalle, pour un petit effet de suspense comme au podium. La ligne de compteurs reste affichée en bas.

L'animateur peut encore retirer un mot pendant la révélation (le serveur l'accepte en phase `reveal` et `scoreboard` et rediffuse `wordcloud:update`). C'est même le moment où un mot gênant s'afficherait en grand. Dans ce cas, décision de l'utilisateur : le mot retiré s'efface du nuage figé (fondu), sans que les autres mots changent de place ; si c'était un mot du top 4, le top 4 est recalculé, le mot suivant s'allume et reçoit sa pastille, et les rangs des pastilles se mettent à jour. L'état de fin est donc dérivé du dernier nuage reçu, pas un instantané pris une seule fois.

Le top 4 suit le même ordre que celui du rapport de partie (occurrences décroissantes, ordre alphabétique en cas d'égalité), pour que le grand écran et le rapport racontent la même chose.

## Non-objectifs

Aucun changement côté serveur, protocole ou données : le rendu consomme le `WordcloudView` actuel (`apps/web/src/realtime/contracts.ts`), déjà trié et plafonné à 100 mots.

L'écran de l'animateur (`HostLive`) garde sa présentation actuelle, en liste avec un bouton de retrait par mot. Choix du concepteur : les boutons de retrait doivent rester faciles à viser, ce qu'un nuage en spirale avec des mots verticaux compromettrait. Le composant actuel peut donc rester tel quel pour l'hôte, le grand écran utilisant le nouveau rendu.

Pas de nuage sur le téléphone du participant (inchangé).

Pas d'export du nuage en image.

## Anti-objectifs

Des mots qui se chevauchent.

Un nuage qui saute ou se réarrange entièrement à chaque mise à jour (environ toutes les 500 ms quand la salle est active).

Un écran qui saccade quand une grande salle envoie beaucoup de mots : la mise en page de 100 mots doit rester assez rapide pour suivre la cadence des mises à jour sans faire chuter l'animation.

Un mot du top 4 absent du nuage parce qu'il n'aurait pas trouvé de place.

## Contraintes

La règle de la couche motion s'applique (`apps/web/src/motion/README.md`) : `framer-motion`, le canvas et Web Audio ne s'importent que dans `apps/web/src/motion/`, garde vérifiée par `architecture.test.ts`. Les animations restent décoratives et ne portent jamais seules une information (les rangs et occurrences du top 4 sont du texte).

En mode « réduire les animations » (`useReducedMotion` de `apps/web/src/motion/MotionProvider.tsx`), pas d'éclosion, de pulsation, de glissement, de scintillement ni d'arrivée échelonnée : les mots apparaissent à leur place, et à la fin l'assombrissement et les quatre pastilles s'affichent d'un coup. Le rendu final est le même.

L'accessibilité actuelle est conservée : le nuage reste annoncé comme une liste de mots avec leurs occurrences (texte masqué visuellement), et le top 4 de fin doit être lisible par un lecteur d'écran.

Le nuage doit tenir dans le grand écran quelle que soit sa résolution (de l'ordre du 720p à la 4K), sans défilement. La maquette calcule la disposition dans un espace virtuel 16:9 de 1600 × 900 mis à l'échelle du cadre ; le constructeur peut reprendre ce principe ou calculer directement dans les dimensions réelles.

Le dépôt n'est pas formaté par Biome : ne pas lancer `biome format --write`. `pnpm lint` et `pnpm typecheck` doivent passer.

## Choix du concepteur

Le placement est une fonction pure maison (spirale elliptique autour du centre, collisions par rectangles englobants, réutilisation de la position précédente), comme dans la maquette, plutôt qu'une dépendance comme d3-cloud, dont le placement au pixel près et asynchrone se prête mal à des mises à jour fréquentes avec positions stables. Cette fonction se teste sans navigateur : pas de chevauchement, premier mot horizontal et au centre, orientation de chaque mot constante, positions conservées d'une mise à jour à l'autre quand c'est possible, top 4 toujours placé. En révélation, la disposition est gelée (positions et tailles) : un retrait enlève le mot sans recalcul, sinon la disparition du premier changerait toutes les tailles.

Les mots placés par ordre d'occurrences décroissantes garantissent que les plus cités trouvent leur place en premier. Un mot de la traîne qui ne trouve aucune place est masqué visuellement mais reste dans la liste accessible et dans les compteurs.

À la reconnexion du grand écran pendant la révélation, l'état final s'affiche directement (nuage assombri, top 4 allumé, pastilles visibles), sans rejouer l'arrivée échelonnée.

## Laissé au constructeur

La technique d'animation (transitions et keyframes CSS sur les tokens de `tokens.motion.css`, ou primitives dans `motion/`), la mesure des mots (DOM ou `measureText`, sachant que le canvas est confiné à `motion/`), les valeurs exactes de taille, d'espacement et de durées en partant de la maquette, la manière exacte d'attendre le chargement de la police Fredoka avant de mesurer, le placement fin des pastilles pour qu'elles ne masquent pas un mot voisin (dans la maquette, la pastille du premier mot tombe parfois trop loin de lui), et l'ajout éventuel d'un son au moment de fin via le registre de cues existant.
