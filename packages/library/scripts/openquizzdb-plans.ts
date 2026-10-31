// Plans des quiz composés et corrections de contenu pour la conversion d'OpenQuizzDB.

// Quiz Pengou composés à partir de quiz source (4 questions chacun), 10 à 20 questions par quiz.
// Un plan donne soit des quiz source entiers (`sources`), soit des questions choisies (`questions`,
// identifiants dans l'ordre du quiz).
export type QuizPlan = {
  slug: string
  title: string
  theme: string
  description?: string
  sources?: number[]
  questions?: string[]
}
export const QUIZZES: QuizPlan[] = [
  { slug: 'cinema-francais', title: 'Stars du cinéma français', theme: 'cinema', sources: [35, 47, 107, 65] },
  { slug: 'sagas-sf', title: 'Sagas de science-fiction', theme: 'cinema', sources: [37, 408, 384, 389] },
  { slug: 'chanson-francaise', title: 'Chanson française', theme: 'musique', sources: [77, 29, 83, 417] },
  { slug: 'new-wave', title: 'Les années new wave', theme: 'musique', sources: [313, 307, 429, 562] },
  { slug: 'football', title: 'Football', theme: 'sport', sources: [87, 99, 502, 400] },
  { slug: 'olympisme-tennis', title: 'Olympisme et tennis', theme: 'sport', sources: [261, 437, 247, 253] },
  {
    slug: 'civilisations-anciennes',
    title: 'Civilisations anciennes',
    theme: 'histoire',
    sources: [453, 199, 550, 127, 513],
  },
  { slug: 'guerres-et-dates', title: 'Batailles et grandes dates', theme: 'histoire', sources: [422, 394, 420, 518] },
  { slug: 'tour-europe', title: "Tour d'Europe", theme: 'geographie', sources: [257, 359, 454, 353, 365] },
  { slug: 'villes-iles-lacs', title: 'Villes, îles et lacs', theme: 'geographie', sources: [360, 542, 428, 91] },
  { slug: 'chimie-corps', title: 'Chimie, corps humain et mesures', theme: 'sciences', sources: [380, 375, 557, 419] },
  { slug: 'planetes-inventeurs', title: 'Planètes et inventeurs', theme: 'sciences', sources: [57, 63, 139, 503] },
  { slug: 'romans-populaires', title: 'Romans populaires', theme: 'litterature', sources: [181, 312, 85, 397] },
  {
    slug: 'bande-dessinee',
    title: 'Bande dessinée',
    theme: 'litterature',
    sources: [464, 469, 459, 105, 567],
  },
  { slug: 'art-musees', title: 'Art et musées', theme: 'art', sources: [405, 377, 466, 145, 399] },
  { slug: 'animaux-du-monde', title: 'Animaux du monde', theme: 'nature', sources: [545, 383, 207, 491] },
  { slug: 'arbres-fleurs-volcans', title: 'Arbres, fleurs et volcans', theme: 'nature', sources: [213, 370, 563, 45] },
  { slug: 'fromages-desserts', title: 'Fromages et desserts', theme: 'gastronomie', sources: [205, 201, 211, 235] },
  { slug: 'cuisines-ailleurs', title: "Cuisines d'ailleurs", theme: 'gastronomie', sources: [519, 523, 445, 390] },
  {
    slug: 'alphaquizz',
    title: 'Culture générale de C à G',
    theme: 'culture-generale',
    sources: [28, 40, 52, 64, 76],
  },
  {
    slug: 'maison-quotidien',
    title: 'La maison et le quotidien',
    theme: 'culture-generale',
    sources: [604, 608, 467, 472],
  },
]

// Questions retirées du catalogue (identifiant vers motif : dépassée, erronée, etc.).
export const EXCLUDED: Record<string, string> = {
  // Quiz source 28 (Alphaquizz #C)
  'oqdb-0028-2': "exactitude douteuse : le grade usurpé par Pithivier n'est pas certain",
  // Quiz source 31 (Frites pas toujours belges)
  'oqdb-0031-4': "exactitude douteuse : fournisseur historique de McDonald's non établi",
  // Quiz source 40 (Alphaquizz #D)
  'oqdb-0040-2': "exactitude douteuse : titre d'homme le plus élégant de France attribué à Dali non vérifiable",
  // Quiz source 52 (Alphaquizz #E)
  'oqdb-0052-2': "exactitude douteuse : l'auteur de la chanson citée est incertain",
  // Quiz source 55 (Voitures à l'écran)
  'oqdb-0055-3': 'exactitude douteuse : Gran Torino est un film de 2008, sorti en France en 2009',
  'oqdb-0055-4': "exactitude douteuse : le modèle de voiture d'Enzo n'est pas certain",
  // Quiz source 63 (Satellites naturels)
  'oqdb-0063-4': 'fait dépassé : de nombreux satellites découverts depuis sont plus éloignés de leur planète que Sinopé',
  // Quiz source 65 (Isabelle Adjani)
  'oqdb-0065-1': 'exactitude douteuse : les interprètes de Mademoiselle Julie sont incertains',
  'oqdb-0065-3': 'exactitude douteuse : année du clip de Pull marine incertaine',
  // Quiz source 77 (Charles Aznavour)
  'oqdb-0077-2': 'exactitude douteuse : la saison citée dans La Bohème est ambiguë',
  // Quiz source 79 (Slogans publicitaires)
  'oqdb-0079-1': "fait dépassé : slogan publicitaire daté, sans date dans l'énoncé",
  // Quiz source 85 (Romans de science-fiction)
  'oqdb-0085-4': 'fait faux : Isaac Asimov est mort en 1992, bien avant OpenAI',
  // Quiz source 88 (Alphaquizz #H)
  'oqdb-0088-4': 'fait faux : La Mort aux trousses est une fiction, pas une histoire vraie',
  // Quiz source 95 (Jack Nicholson)
  'oqdb-0095-3': "Incompréhensible sans contexte : « sa partenaire » ne nomme pas l'acteur.",
  // Quiz source 109 (Animaux en chiffres)
  'oqdb-0109-4': "Exactitude douteuse : une otarie peut rester sous l'eau bien plus de 5 minutes, plusieurs propositions sont plausibles.",
  // Quiz source 111 (Les héros de l’Ironman)
  'oqdb-0111-3': "Exactitude douteuse : le nombre de finalistes à Kona varie selon les années et n'est pas de 2 000.",
  // Quiz source 123 (Joyeux Noël)
  'oqdb-0123-2': "Exactitude douteuse : l'attribution de la coutume de la dinde à Charles VII est une légende.",
  // Quiz source 125 (Christophe Dechavanne)
  'oqdb-0125-1': "Incompréhensible sans contexte : « à ses côtés » ne nomme pas l'animateur.",
  'oqdb-0125-4': "Incompréhensible sans contexte : la personne n'est pas nommée, et contenu moqueur envers une personne réelle.",
  // Quiz source 127 (Teotihuacan)
  'oqdb-0127-3': "Exactitude douteuse : la cause de la chute de Teotihuacan est débattue, l'incendie n'est pas établi comme seule cause.",
  // Quiz source 129 (Zombies)
  'oqdb-0129-1': 'Bonne réponse ambiguë : brûler un zombie en vient aussi à bout dans la plupart des fictions.',
  // Quiz source 137 (Maria Sharapova)
  'oqdb-0137-1': 'Incompréhensible sans contexte : « Elle » ne nomme pas la joueuse.',
  // Quiz source 139 (Alan Turing)
  'oqdb-0139-3': "Exactitude douteuse : le programme de 1952 de Turing n'a pas été écrit pour réaliser son test.",
  'oqdb-0139-4': "Fait faux : Enigma n'a jamais été implémenté dans un système informatique comme UNIX.",
  // Quiz source 143 (Jean-Pierre Foucault)
  'oqdb-0143-4': "Exactitude douteuse : l'identité de la première animatrice de Disney Parade n'est pas assurée.",
  // Quiz source 149 (Scarlett Johansson)
  'oqdb-0149-4': 'Bonne réponse ambiguë : Scoop réunit aussi Scarlett Johansson et Hugh Jackman.',
  // Quiz source 153 (Voiture électrique)
  'oqdb-0153-4': 'Fait faux ou ambigu : Tesla était le premier vendeur de voitures 100 % électriques en 2022, BYD le premier en véhicules électrifiés.',
  // Quiz source 161 (Valérie Lemercier)
  'oqdb-0161-1': 'exactitude douteuse : titre de la chanson et édition des Césars non vérifiables',
  'oqdb-0161-3': "exactitude douteuse : la participation de Lemercier au film de Podalydès n'est pas certaine pour les autres titres",
  // Quiz source 171 (Crypto-monnaies)
  'oqdb-0171-2': "fait faux : les cryptomonnaies offrent surtout le pseudonymat, pas l'anonymat",
  // Quiz source 173 (Barack Obama)
  'oqdb-0173-2': "exactitude douteuse : les vraies professions d'Obama (juriste, militant) ne figurent pas parmi les choix",
  // Quiz source 177 (Princesses Disney)
  'oqdb-0177-3': 'bonne réponse ambiguë : Aurore est associée au rose comme au bleu',
  // Quiz source 183 (Super-héros)
  'oqdb-0183-3': 'bonne réponse ambiguë : Tim Drake est aussi un Robin',
  // Quiz source 184 (Alphaquizz #P)
  'oqdb-0184-4': "fait dépassé : on utilise aujourd'hui surtout des chiens pour trouver les truffes",
  // Quiz source 185 (Sandra Bullock)
  'oqdb-0185-4': "exactitude douteuse : Demolition Man est un film d'action, pas son premier thriller",
  // Quiz source 189 (Bières belges)
  'oqdb-0189-3': 'exactitude douteuse : type de bouchon de la Quintine non vérifiable',
  // Quiz source 203 (Shakira)
  'oqdb-0203-1': 'exactitude douteuse : contenu du verso de la pochette non vérifiable',
  // Quiz source 209 (Johnny Depp en privé)
  'oqdb-0209-2': 'contenu moqueur envers une personne réelle (Kate Moss qualifiée de brindille)',
  // Quiz source 231 (Univers Star Trek)
  'oqdb-0231-4': "fait dépassé en 2026 : « derniers films » et Spock est depuis joué par d'autres acteurs",
  // Quiz source 233 (Keanu Reeves)
  'oqdb-0233-4': 'fait faux : Keanu Reeves a refusé Speed 2 pour jouer Hamlet au théâtre, pas pour son poids',
  // Quiz source 239 (Eminem)
  'oqdb-0239-4': "fait dépassé en 2026 : « jeune chanteuse » et « protégée » ne sont plus d'actualité",
  // Quiz source 251 (Bulgarie)
  'oqdb-0251-3': 'bonne réponse ambiguë : le lion est le symbole national de la Bulgarie',
  // Quiz source 255 (La vie de château)
  'oqdb-0255-2': 'bonne réponse ambiguë : Amboise était aussi une résidence favorite',
  // Quiz source 259 (Animateurs télé)
  'oqdb-0259-3': 'exactitude douteuse : dates de présentation du Grand Concours des Animateurs non vérifiables',
  // Quiz source 265 (Présentateurs du JT)
  'oqdb-0265-2': 'exactitude douteuse : succession de Claude Sérillon à France 2 non vérifiable',
  // Quiz source 271 (Potins de stars 2013)
  'oqdb-0271-1': 'exactitude douteuse : potin de 2013 non vérifiable',
  'oqdb-0271-2': 'exactitude douteuse : potin de 2013 non vérifiable',
  'oqdb-0271-3': 'exactitude douteuse : potin de 2013 non vérifiable',
  'oqdb-0271-4': "fait faux : l'incident de la piscine d'Usher date de 2012",
  // Quiz source 275 (Irlande)
  'oqdb-0275-4': 'bonne réponse ambiguë : Halloween trouve aussi ses origines en Irlande',
  // Quiz source 279 (Patrick Sébastien)
  'oqdb-0279-2': 'exactitude douteuse : pseudonyme non vérifiable',
  'oqdb-0279-3': 'exactitude douteuse : production du one-man-show non vérifiable',
  'oqdb-0279-4': 'exactitude douteuse : première grande émission sur TF1 non vérifiable',
  // Quiz source 280 (Alphaquizz #X)
  'oqdb-0280-3': "fait faux : la souris a été inventée par Douglas Engelbart (SRI), Xerox l'a développée",
  // Quiz source 293 (Antoine Griezmann)
  'oqdb-0293-1': 'question incompréhensible sans le nom du joueur, et exactitude douteuse (débuts espagnols à la Real Sociedad).',
  'oqdb-0293-2': "question incompréhensible sans le contexte du quiz d'origine (pas de nom dans l'énoncé).",
  'oqdb-0293-4': "question incompréhensible sans le contexte du quiz d'origine, et numéro susceptible d'avoir changé.",
  // Quiz source 299 (Léa Seydoux)
  'oqdb-0299-3': "fait faux : Léa Seydoux n'a pas joué dans Django Unchained.",
  'oqdb-0299-4': "question incompréhensible sans le contexte du quiz d'origine (pas de nom dans l'énoncé).",
  // Quiz source 303 (Linux)
  'oqdb-0303-1': 'fait dépassé en 2026 : poste en cours (« dirige encore »).',
  // Quiz source 304 (Alphaquizz #Z)
  'oqdb-0304-3': 'exactitude douteuse : duo Sting et Ziggy Marley non établi.',
  // Quiz source 305 (François Damiens)
  'oqdb-0305-1': "question incompréhensible sans le contexte du quiz d'origine (pas de nom dans l'énoncé).",
  'oqdb-0305-2': "question incompréhensible sans le contexte du quiz d'origine (pas de nom dans l'énoncé).",
  // Quiz source 306 (Bruce Willis en privé)
  'oqdb-0306-3': "exactitude douteuse : maîtrise courante de l'allemand non établie.",
  // Quiz source 311 (Stromae)
  'oqdb-0311-4': 'bonne réponse ambiguë : Formidable aborde aussi une rupture avec ironie.',
  // Quiz source 322 (Potins de stars 2014)
  'oqdb-0322-2': 'exactitude douteuse : émancipation de sa famille en 2014 non établie.',
  // Quiz source 323 (Kylian Mbappé)
  'oqdb-0323-4': 'fait dépassé en 2026 : numéro de maillot en cours, susceptible de changer.',
  // Quiz source 328 (Automobile)
  'oqdb-0328-4': 'fait faux : le « dentier » désigne la calandre, pas la boîte de vitesses.',
  // Quiz source 329 (Aya Nakamura)
  'oqdb-0329-4': 'exactitude douteuse : attribution de la phrase à ce titre non établie.',
  // Quiz source 330 (Zorg)
  'oqdb-0330-4': 'exactitude douteuse : durée du minuteur de la bombe non établie.',
  // Quiz source 331 (Modèles de voiture)
  'oqdb-0331-2': 'exactitude douteuse : voiture de Tintin au Congo non établie.',
  // Quiz source 337 (Datte medjool)
  'oqdb-0337-1': "exactitude douteuse : la datte medjool est aujourd'hui produite surtout ailleurs qu'au Maroc.",
  // Quiz source 343 (Le Grand Bleu)
  'oqdb-0343-3': 'exactitude douteuse : plat favori du personnage non établi.',
  // Quiz source 347 (Luxembourg)
  'oqdb-0347-2': 'bonne réponse ambiguë : monarchie et grand-duché sont aussi justes.',
  // Quiz source 348 (Grandes randonnées)
  'oqdb-0348-4': 'exactitude douteuse : origine du balisage rouge non établie.',
  // Quiz source 351 (Réalisatrices)
  'oqdb-0351-2': "question incompréhensible sans le contexte du quiz d'origine (pas de nom dans l'énoncé).",
  // Quiz source 352 (Cheveux)
  'oqdb-0352-1': 'bonne réponse ambiguë (frisés ou crépus) et généralisation maladroite.',
  // Quiz source 355 (Les Visiteurs 2)
  'oqdb-0355-2': 'exactitude douteuse : détail de scène non établi.',
  'oqdb-0355-3': 'exactitude douteuse : uniformes du film non établis.',
  'oqdb-0355-4': 'exactitude douteuse : distribution du rôle non établie.',
  // Quiz source 357 (Sports collectifs)
  'oqdb-0357-4': 'exactitude douteuse : nombre de cercles discutable.',
  // Quiz source 359 (Autriche)
  'oqdb-0359-4': 'bonne réponse ambiguë : Vienne est aussi liée à Mozart.',
  // Quiz source 369 (Stars de la NBA)
  'oqdb-0369-3': 'exactitude douteuse : titre de joueur de la décennie 2000 discutable.',
  // Quiz source 371 (Petits mammifères)
  'oqdb-0371-4': "exactitude douteuse : organe d'orientation de la taupe discutable.",
  // Quiz source 373 (Istanbul)
  'oqdb-0373-4': "fait faux : aucune mosquée d'Istanbul n'est un point de départ des pèlerins.",
  // Quiz source 378 (Basket européen)
  'oqdb-0378-1': 'fait dépassé en 2026 : la Pro A a été rebaptisée depuis.',
  'oqdb-0378-3': 'exactitude douteuse : premier fournisseur non américain de la NBA, le Canada est devant.',
  'oqdb-0378-4': 'exactitude douteuse : sigle de la fédération belge non établi.',
  // Quiz source 385 (Règles du basket)
  'oqdb-0385-1': 'bonne réponse ambiguë : 5 joueurs par équipe, 10 au total',
  // Quiz source 386 (Boucles de corde)
  'oqdb-0386-3': 'exactitude douteuse : le nom « noeud double » pour le noeud entier est incertain',
  'oqdb-0386-4': 'bonne réponse ambiguë : noeud carré et noeud plat désignent le même noeud',
  // Quiz source 388 (Mannequins français)
  'oqdb-0388-4': "contenu choquant envers une personne réelle (passé d'escort-girl)",
  // Quiz source 389 (Androïdes dans Alien)
  'oqdb-0389-3': 'exactitude douteuse : personnage et événement incertains',
  // Quiz source 392 (Alien Passagers)
  'oqdb-0392-4': 'fait faux : le Nostromo est détruit, seule la navette Narcissus revient',
  // Quiz source 393 (Hunger Games)
  'oqdb-0393-3': 'fait faux : les baies mortelles sont les « baies de la nuit »',
  // Quiz source 395 (Haut en couleur)
  'oqdb-0395-1': 'bonne réponse ambiguë : le curaçao existe aussi en orange',
  // Quiz source 397 (Héros de Hunger Games)
  'oqdb-0397-2': 'question incompréhensible sans le contexte du livre',
  'oqdb-0397-3': "exactitude douteuse : donneur de l'objet incertain",
  // Quiz source 403 (Peeta dans Hunger Games)
  'oqdb-0403-2': 'question incompréhensible sans le contexte du film',
  'oqdb-0403-3': 'fait faux : Peeta est blessé à la jambe par une épée',
  'oqdb-0403-4': 'exactitude douteuse : détail de camouflage incertain',
  // Quiz source 404 (Peuples dans l’histoire)
  'oqdb-0404-4': 'exactitude douteuse : installation des Parsis en Inde plutôt au VIIIe-Xe siècle',
  // Quiz source 405 (Musée du Louvre)
  'oqdb-0405-3': 'exactitude douteuse : chiffre invérifiable',
  'oqdb-0405-4': 'fait faux : le Louvre expose plus de trois tableaux de Léonard de Vinci',
  // Quiz source 408 (Héros de Star Wars)
  'oqdb-0408-1': 'fait faux : Anakin est né sur Tatooine',
  // Quiz source 409 (Romans de Maxime Chattam)
  'oqdb-0409-2': 'exactitude douteuse : détail du roman incertain',
  'oqdb-0409-3': 'exactitude douteuse : détail du roman incertain',
  'oqdb-0409-4': 'exactitude douteuse : détail du roman incertain',
  // Quiz source 411 (Japon)
  'oqdb-0411-2': 'exactitude douteuse : le jeu se nomme « janken » en japonais',
  // Quiz source 417 (Chanteurs français)
  'oqdb-0417-1': 'exactitude douteuse : surnom incertain',
  'oqdb-0417-4': "exactitude douteuse : titre de l'album incertain",
  // Quiz source 418 (Vocabulaire du vin)
  'oqdb-0418-1': 'bonne réponse ambiguë : le nez désigne aussi les sensations olfactives',
  // Quiz source 427 (Marques de café)
  'oqdb-0427-3': "exactitude douteuse : couleurs de l'emballage incertaines",
  // Quiz source 434 (Titres de Depeche Mode)
  'oqdb-0434-3': 'exactitude douteuse : premier morceau écrit par Martin Gore incertain',
  // Quiz source 437 (Rio 2016)
  'oqdb-0437-2': "fait faux : la flamme s'éteint, c'est le drapeau olympique qui est remis à Tokyo",
  // Quiz source 444 (Culture sociale)
  'oqdb-0444-1': 'question incompréhensible sans le nom connu de la personne',
  // Quiz source 455 (Folklore)
  'oqdb-0455-4': "fait faux : le chat noir porte bonheur à bord, c'est le lapin qui porte malheur",
  // Quiz source 472 (Moyens de transport)
  'oqdb-0472-1': 'exactitude douteuse : les médecins volants australiens utilisent surtout des avions',
  // Quiz source 478 (Haltérophilie)
  'oqdb-0478-2': 'bonne réponse ambiguë : craie et magnésie désignent la même poudre',
  // Quiz source 484 (Lexique du véliplanchiste)
  'oqdb-0484-1': 'bonne réponse ambiguë : le tack change aussi la direction',
  // Quiz source 498 (Boissons de stars)
  'oqdb-0498-4': 'exactitude douteuse : partenariat de Neymar non établi',
  // Quiz source 502 (Histoire du foot)
  'oqdb-0502-1': 'fait faux : sept pays fondateurs, aucune proposition ne convient',
  // Quiz source 505 (Marques de jus de fruits)
  'oqdb-0505-4': "exactitude douteuse : lien entre Joker et l'usine de Mâcon non sûr",
  // Quiz source 508 (Vins de France)
  'oqdb-0508-4': 'fait faux : le Marignan est un vin de Savoie',
  // Quiz source 510 (Slogans automobiles)
  'oqdb-0510-2': 'fait dépassé : slogan publicitaire changé',
  'oqdb-0510-3': 'fait dépassé : slogan publicitaire changé',
  'oqdb-0510-4': 'fait dépassé : slogan publicitaire changé',
  // Quiz source 514 (Vins du monde)
  'oqdb-0514-4': 'fait dépassé : le Riesling est désormais le cépage blanc le plus planté',
  // Quiz source 519 (Cuisine italienne)
  'oqdb-0519-3': "bonne réponse ambiguë : l'osso buco se prépare aussi à la milanaise",
  'oqdb-0519-4': 'bonne réponse ambiguë : le panzerotto est aussi une pizza pliée des Pouilles',
  // Quiz source 522 (Dragon Ball Z)
  'oqdb-0522-1': 'exactitude douteuse : nombre de destructions de la Lune incertain',
  // Quiz source 523 (Des pâtes, oui !)
  'oqdb-0523-3': 'bonne réponse ambiguë : fettuccine aussi en lanières',
  // Quiz source 527 (Sport féminin international)
  'oqdb-0527-3': 'exactitude douteuse : Ana Carrasco a gagné en championnat du monde Supersport 300, pas en GP',
  // Quiz source 528 (Monarchie)
  'oqdb-0528-4': 'bonne réponse ambiguë : émir, sultan et calife conviennent',
  // Quiz source 538 (Neige en littérature)
  'oqdb-0538-3': "exactitude douteuse : auteur de L'autre versant non vérifiable",
  // Quiz source 545 (Animaux de la savane)
  'oqdb-0545-2': "Bonne réponse ambiguë : le lynx marque aussi avec l'urine et les excréments.",
  // Quiz source 547 (Sports hivernaux)
  'oqdb-0547-3': 'Bonne réponse ambiguë : le fart est une cire, « Cire » est aussi juste.',
  // Quiz source 553 (Sacré Bob)
  'oqdb-0553-4': "Exactitude douteuse : la couleur des pantoufles de l'Homme Sirène n'est pas sûre.",
  // Quiz source 554 (Géo pour tous)
  'oqdb-0554-3': 'Bonne réponse ambiguë : le fleuve Sénégal borde aussi le Sahel.',
  // Quiz source 557 (Corps humain)
  'oqdb-0557-3': "Exactitude douteuse : le record d'éternuement cité est généralement d'environ 160 km/h.",
  // Quiz source 559 (Expéditions de Mike Horn)
  'oqdb-0559-4': "Exactitude douteuse : la durée de la traversée du Groenland n'est pas sûre.",
  // Quiz source 565 (Albums de France Gall)
  'oqdb-0565-2': "Exactitude douteuse : le premier album studio de France Gall n'est pas sûr.",
  // Quiz source 567 (Super-héroïnes)
  'oqdb-0567-2': 'Bonne réponse ambiguë : Nocturne se téléporte aussi.',
  'oqdb-0567-3': 'Exactitude douteuse : la réponse Cipher est incertaine.',
  // Quiz source 568 (Forêts de France)
  'oqdb-0568-1': 'Exactitude douteuse : classement des forêts domaniales incertain et daté.',
  // Quiz source 569 (Coca-Cola Company)
  'oqdb-0569-3': 'Fait dépassé : le partenariat Nestlé et Coca-Cola pour Nestea a pris fin.',
  // Quiz source 575 (Une larme de gin)
  'oqdb-0575-3': 'Exactitude douteuse : Churchill était plutôt connu pour le whisky et le champagne.',
  'oqdb-0575-4': "Bonne réponse ambiguë : « pionnière » est subjectif, d'autres marques le sont aussi.",
  // Quiz source 577 (Cocktails à base de gin)
  'oqdb-0577-3': "Exactitude douteuse : la composition du Baltimore n'est pas sûre.",
  // Quiz source 578 (Golf)
  'oqdb-0578-2': "Bonne réponse ambiguë : l'alphabet phonétique est aussi l'alphabet radio.",
  // Quiz source 584 (Récompenses aux César)
  'oqdb-0584-4': "Exactitude douteuse : Ozon n'a pas reçu de César pour Frantz.",
  // Quiz source 585 (Intrusion #1)
  'oqdb-0585-3': "Exactitude douteuse : Charlot n'est pas un adepte reconnu du noeud papillon.",
  // Quiz source 587 (Stars mondiales #2)
  'oqdb-0587-1': 'Contenu moqueur et intime envers des personnes réelles.',
  'oqdb-0587-4': "Exactitude douteuse : l'admiration de Bieber pour Hendrix n'est pas établie.",
  // Quiz source 592 (Ça pique ou ça passe)
  'oqdb-0592-2': 'Exactitude douteuse : la famille compte plutôt autour de 1 750 espèces.',
  'oqdb-0592-3': "Exactitude douteuse : cette peine de prison pour la cueillette n'est pas établie.",
  // Quiz source 595 (Intrusion #3)
  'oqdb-0595-1': 'Fait faux : les quatre mots sont masculins.',
  // Quiz source 598 (Stars mondiales #3)
  'oqdb-0598-1': "Contenu choquant : question sur le passé X d'une personne réelle.",
  'oqdb-0598-2': 'Contenu choquant envers une personne réelle.',
  'oqdb-0598-3': 'Fait dépassé : « jeune actrice montante » est daté.',
  // Quiz source 601 (Intrusion #4)
  'oqdb-0601-1': 'Exactitude douteuse : les parcours scolaires de ces chanteuses ne sont pas fiables.',
  // Quiz source 603 (En avant la jeunesse)
  'oqdb-0603-4': 'Bonne réponse ambiguë : la moule peut aussi contenir une perle.',
  // Quiz source 604 (Dans la maison)
  'oqdb-0604-3': 'Bonne réponse ambiguë : balcon ou mezzanine, énoncé flou.',
  // Quiz source 605 (Mouscron)
  'oqdb-0605-2': "Exactitude douteuse : le cortège d'ouverture de la fête des Hurlus n'est pas sûr.",
  'oqdb-0605-3': 'Fait dépassé : « actrice montante » est daté.',
  'oqdb-0605-4': "Exactitude douteuse : la reconversion de la piscine n'est pas sûre.",
  // Quiz source 610 (Citations courtes)
  'oqdb-0610-1': "Exactitude douteuse : la citation n'est pas attribuable à Oscar Wilde.",
  'oqdb-0610-2': 'Exactitude douteuse : attribution à Confucius improbable.',
}

// Thème d'une question (identifiant vers thème), prioritaire sur celui de sa catégorie.
export const QUESTION_THEME: Record<string, string> = {
  'oqdb-0027-2': 'television',
  'oqdb-0027-3': 'jeux-video',
  'oqdb-0027-4': 'litterature',
  'oqdb-0033-1': 'litterature',
  'oqdb-0033-3': 'culture-generale',
  'oqdb-0033-4': 'culture-generale',
  'oqdb-0055-1': 'television',
  'oqdb-0069-1': 'geographie',
  'oqdb-0069-4': 'sciences',
  'oqdb-0088-2': 'television',
  'oqdb-0089-1': 'cinema',
  'oqdb-0089-2': 'cinema',
  'oqdb-0089-4': 'cinema',
  'oqdb-0101-1': 'television',
  'oqdb-0112-2': 'television',
  'oqdb-0112-3': 'cinema',
  'oqdb-0124-2': 'musique',
  'oqdb-0129-2': 'television',
  'oqdb-0129-3': 'jeux-video',
  'oqdb-0135-2': 'culture-generale',
  'oqdb-0135-3': 'sport',
  'oqdb-0135-4': 'histoire',
  'oqdb-0148-4': 'musique',
  'oqdb-0163-3': 'nature',
  'oqdb-0167-1': 'television',
  'oqdb-0167-2': 'people',
  'oqdb-0167-3': 'people',
  'oqdb-0167-4': 'people',
  'oqdb-0291-1': 'cinema',
  'oqdb-0291-3': 'cinema',
  'oqdb-0291-4': 'cinema',
  'oqdb-0292-4': 'cinema',
  'oqdb-0304-4': 'musique',
  'oqdb-0309-1': 'television',
  'oqdb-0328-1': 'sport',
  'oqdb-0338-1': 'cinema',
  'oqdb-0338-3': 'litterature',
  'oqdb-0338-4': 'litterature',
  'oqdb-0391-2': 'television',
  'oqdb-0426-1': 'jeux-video',
  'oqdb-0426-3': 'jeux-video',
  'oqdb-0426-4': 'jeux-video',
  'oqdb-0431-3': 'television',
  'oqdb-0433-1': 'television',
  'oqdb-0433-4': 'television',
  'oqdb-0443-1': 'cinema',
  'oqdb-0446-1': 'cinema',
  'oqdb-0446-2': 'television',
  'oqdb-0446-3': 'cinema',
  'oqdb-0446-4': 'television',
  'oqdb-0449-3': 'cinema',
  'oqdb-0450-2': 'cinema',
  'oqdb-0452-1': 'cinema',
  'oqdb-0452-2': 'cinema',
  'oqdb-0452-3': 'cinema',
  'oqdb-0452-4': 'cinema',
  'oqdb-0548-1': 'litterature',
  'oqdb-0549-2': 'musique',
  'oqdb-0549-4': 'histoire',
  'oqdb-0555-1': 'cinema',
  'oqdb-0555-2': 'cinema',
  'oqdb-0555-3': 'television',
  'oqdb-0555-4': 'cinema',
}

// Questions isolées pour adultes, en plus des quiz source de `ADULT_QUIZZES`.
export const ADULT_QUESTIONS: string[] = [
  'oqdb-0079-2',
  'oqdb-0119-3',
  'oqdb-0131-1',
  'oqdb-0167-4',
  'oqdb-0219-3',
  'oqdb-0275-3',
  'oqdb-0324-4',
  'oqdb-0374-2',
  'oqdb-0395-3',
  'oqdb-0457-3',
  'oqdb-0539-2',
]
