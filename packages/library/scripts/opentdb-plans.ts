// Plans de la retouche d'Open Trivia DB (voir curate-opentdb.ts).

// Questions retirées, avec leur motif (revue de 2026-10-31 : faits dépassés, faux, douteux,
// réponses ambiguës, énoncés incompréhensibles).
export const EXCLUDED: Record<string, string> = {
  'otdb-00932b41ea9a': 'exactitude douteuse : présence du fusil à pompe dans chaque épisode numéroté non vérifiable',
  'otdb-036a286183ea': 'question incompréhensible : bus « supplémentaire » mal défini',
  'otdb-050d26b00d07': 'exactitude douteuse : présence de Pac-Man dans Tron non établie avec certitude',
  'otdb-0708a3698519': 'bonne réponse ambiguë : Québec fut capitale avant Kingston selon le sens de « Canada »',
  'otdb-13ecbd16d75a': 'exactitude douteuse : niveau requis pour la médaille de service incertain',
  'otdb-15ef0171aa74': 'exactitude douteuse : lectures du personnage incertaines',
  'otdb-15f7a84a4083': 'exactitude douteuse : vitesse des véhicules modifiée par les mises à jour',
  'otdb-1ada3e1e5132': 'exactitude douteuse : les ventes de Tetris sont estimées à plus de 500 millions',
  'otdb-1e5c74c29389': 'bonne réponse ambiguë : surcharge ou redéfinition selon la lecture',
  'otdb-1e7b02458957': "exactitude douteuse : nombre d'as non vérifiable",
  'otdb-223fd3053398': 'exactitude douteuse : liste des armes spéciales incertaine',
  'otdb-22a9007988b2': 'exactitude douteuse : origine du terme « Golden Master » non vérifiée',
  'otdb-27afe74a37fb': 'bonne réponse ambiguë : le livre le plus vendu est contesté (Don Quichotte, Bible)',
  'otdb-2abe53ef3e37': 'question incompréhensible : intitulé et propositions confus',
  'otdb-2d7b488a0200': "exactitude douteuse : le bleu du ciel vient de la diffusion de Rayleigh, pas d'un seul élément",
  'otdb-3b876b70f89f': 'exactitude douteuse : durée de vie du chat sauvage variable selon les sources',
  'otdb-3d94b1eb1cb5': 'exactitude douteuse : le modèle varie selon les Fallout',
  'otdb-3e245f8a76ed': "fait dépassé en 2026 : Virgin Trains et Virgin Racing n'existent plus",
  'otdb-3f066c57e185': 'exactitude douteuse : condition de fabrication selon la version du jeu',
  'otdb-4160e88de68a': 'exactitude douteuse : titres de pistes de la série SATURATION non vérifiables',
  'otdb-4465e986ff44': 'exactitude douteuse : taux critique non vérifiable',
  'otdb-4b7d117b5d4f': 'exactitude douteuse : nombre de voitures non vérifiable',
  'otdb-4bae7f65e789': 'bonne réponse ambiguë : noyau NT dit hybride ou monolithique selon les sources',
  'otdb-501457e7a6bc': 'exactitude douteuse : anecdote non vérifiable',
  'otdb-574cc369cf42': 'question incompréhensible : réponse tautologique et ambiguë',
  'otdb-5a384ea00442': "bonne réponse ambiguë : NovodeX et Ageia (qui l'a racheté) peuvent tous deux être cités comme auteur de PhysX",
  'otdb-621d59541424': 'exactitude douteuse : audition de Kurt Russell pour le rôle de Luke non établie',
  'otdb-62b1bfb4d866': 'exactitude douteuse : rôle de producteur exécutif non vérifiable',
  'otdb-666dedbcc9d1': 'bonne réponse ambiguë : la distinction entre gothique anglais et français ne se réduit pas à la voûte en éventail',
  'otdb-68d4208c9dd2': 'bonne réponse ambiguë : la numérotation des rangées du triangle de Pascal varie (1 4 6 4 1 ou 1 5 10 10 5 1)',
  'otdb-6c2003d0c5ef': "question incompréhensible : formulation confuse sur l'auteur de la preuve et sur « Sun Tzu »",
  'otdb-71320469cb32': 'exactitude douteuse : fait de développement non confirmé',
  'otdb-72acfccb19c3': 'exactitude douteuse : pas de niveau maximal fixe dans Oblivion',
  'otdb-741f54d2bbe8': "fait faux : la formule donnée est celle du volume, l'aire d'une sphère est 4πr²",
  'otdb-75266af6090c': 'fait faux : Android, et non iOS, dominait le marché des systèmes mobiles en 2012',
  'otdb-756a635e73dc': 'bonne réponse ambiguë : surnom « Bible du hip-hop » contesté entre plusieurs albums',
  'otdb-77e10724f080': 'exactitude douteuse : anecdote probablement apocryphe',
  'otdb-7f006f228618': 'exactitude douteuse : C# a été annoncé en 2000 mais publié en 2002 avec .NET',
  'otdb-86fe248ae6cf': 'bonne réponse ambiguë : plusieurs batteurs avant Pete Best (Norman Chapman, Tommy Moore)',
  'otdb-8782ad8fc243': "bonne réponse ambiguë : question reposant sur une faute d'orthographe (« Cartillary » pour capillarité)",
  'otdb-88e3f06bf68c': 'bonne réponse ambiguë : un Mac est un ordinateur personnel, mais « PC » désigne souvent un ordinateur Windows',
  'otdb-89de4d427e42': 'exactitude douteuse : fin du personnage non vérifiable',
  'otdb-8b839ed68653': 'question incompréhensible : énoncé de QCM présenté comme un vrai/faux',
  'otdb-9209cec03f62': 'exactitude douteuse : dégâts modifiés par les mises à jour',
  'otdb-931fac5360c5': "exactitude douteuse : Venise ou d'autres villes sont souvent citées, le classement est contesté",
  'otdb-93d6ebf6d590': "fait dépassé en 2026 : Harry Kane a dépassé Wayne Rooney comme meilleur buteur de l'Angleterre",
  'otdb-93ea0239785d': 'exactitude douteuse : créature des Dieux Très Anciens incertaine',
  'otdb-93f8c6e95485': 'exactitude douteuse : réponse non vérifiable',
  'otdb-a32cf9d333b3': 'bonne réponse ambiguë : le comportement de la touche Impr écran dépend de la version de Windows',
  'otdb-aa56bcf97574': 'exactitude douteuse : le nom accepté du pommier domestique est Malus domestica, Malus pumila en est un synonyme',
  'otdb-ac174548f3b6': "bonne réponse ambiguë : l'aubergine est un légume en cuisine mais un fruit en botanique",
  'otdb-adedb34c9a4c': "fait faux : les ribosomes synthétisent les protéines, pas l'ADN",
  'otdb-af526f7c67a6': "bonne réponse ambiguë : on parle de trois ou quatre lois selon que l'on compte le principe zéro",
  'otdb-afa9d4771193': 'exactitude douteuse : liste des formes incertaine',
  'otdb-b2198ff06df6': 'fait faux : les cellules du corps humain ont 46 chromosomes (23 paires)',
  'otdb-b33f22361aec': 'bonne réponse ambiguë : victoire en février 2010 pour la saison 2009',
  'otdb-b410db6c9f14': "exactitude douteuse : le nombre de pattes des chilopodes dépend de l'espèce, plusieurs propositions sont impossibles",
  'otdb-b8fa4b62076f': 'exactitude douteuse : sens de « Lamora » en throne therin non vérifiable',
  'otdb-b92cff471f0a': 'bonne réponse ambiguë : SSD se développe en Solid State Drive ou Solid State Disk',
  'otdb-be21acbb7caa': 'exactitude douteuse : prototype de manette non vérifiable',
  'otdb-c7582fd2a8da': "fait faux : El Niño pousse l'eau chaude vers l'est du Pacifique, côtes d'Amérique du Sud",
  'otdb-c7e2899ff963': 'bonne réponse ambiguë : le déplacement se note aussi s ou d',
  'otdb-cc089b4bfcd0': 'exactitude douteuse : fait de fiction obscur et non vérifiable',
  'otdb-ce5580ee3490': 'bonne réponse ambiguë : la hyène rit par nervosité, frustration ou excitation',
  'otdb-d4736cba5846': 'fait faux : Occultic;Nine fait partie de la série Science Adventure',
  'otdb-d660060fbab2': 'exactitude douteuse : des roses bleues obtenues par génie génétique existent',
  'otdb-d6aafd2eb6fe': 'bonne réponse ambiguë : plusieurs groupes revendiquent une formation inchangée',
  'otdb-d7913206f611': 'exactitude douteuse : inventions du personnage incertaines',
  'otdb-df5eef8b4ccc': "bonne réponse ambiguë : la glycolyse produit aussi de l'ATP",
  'otdb-e2905073c722': "fait faux : l'ONU compte 193 États membres",
  'otdb-e33d7831238f': 'exactitude douteuse : animal du pyjama incertain',
  'otdb-e389165a9499': 'fait faux : la Maison-Blanche a brûlé le 24 août 1814, pas 1812',
  'otdb-e4573759429d': 'bonne réponse ambiguë : plus ancienne franchise selon le critère retenu (Braves, Cubs)',
  'otdb-e70e2fe719da': "question incompréhensible : énoncé confus sur le formatage d'un DVD-R",
  'otdb-ebda045c58af': 'exactitude douteuse : voitures du jeu non vérifiables',
  'otdb-ecc98988b1f9': "bonne réponse ambiguë : la date d'achèvement de la Joconde varie selon les sources",
  'otdb-f27242c209fc': "exactitude douteuse : certaines zones d'Europe sont classées désertiques (Tabernas, Oltenia)",
  'otdb-f3fea19a153d': 'exactitude douteuse : attribution de la bande son incertaine',
  'otdb-f4badef7195d': "exactitude douteuse : l'énoncé est un jeu sur le mot Epoch, réponse peu défendable",
  'otdb-f5582eab7bbc': 'bonne réponse ambiguë : carte graphique ou processeur selon la configuration',
  'otdb-f7c35044c45c': "exactitude douteuse : scène d'ouverture incertaine",
}

// Reclassements de thème (question vers son nouveau thème) : une question reclassée change de fichier.
export const QUESTION_THEME: Record<string, string> = {
  'otdb-08084f9a24ed': 'sport',
  'otdb-156bcc53194d': 'gastronomie',
  'otdb-16c5ebcfb938': 'sciences',
  'otdb-1e0d6a4763b8': 'sciences',
  'otdb-20357285a49a': 'art',
  'otdb-290493c71112': 'jeux-video',
  'otdb-2d49b96a34f1': 'jeux-video',
  'otdb-31a3c42d587e': 'nature',
  'otdb-32080e238f7a': 'sciences',
  'otdb-32dfe9ed2fef': 'gastronomie',
  'otdb-4aca7400693c': 'musique',
  'otdb-4f33b3195ec7': 'gastronomie',
  'otdb-4fab33f38e71': 'jeux-video',
  'otdb-5066a9e5567c': 'geographie',
  'otdb-530f585afb05': 'sciences',
  'otdb-55b700aca9f5': 'culture-generale',
  'otdb-581bc67061a6': 'litterature',
  'otdb-5bd29c83b392': 'jeux-video',
  'otdb-5ea0f55201b5': 'nature',
  'otdb-7c50e0e0f244': 'gastronomie',
  'otdb-862aa8926bd9': 'litterature',
  'otdb-884950d93345': 'jeux-video',
  'otdb-89099f00bba7': 'nature',
  'otdb-89a263bb2a6a': 'sport',
  'otdb-8e3d4fd4fbee': 'sciences',
  'otdb-92eb5125f007': 'gastronomie',
  'otdb-9618c355b1f9': 'geographie',
  'otdb-973b51a3c544': 'art',
  'otdb-9c4e2c92d1b4': 'sciences',
  'otdb-9e82e246c793': 'nature',
  'otdb-a64dba54c749': 'gastronomie',
  'otdb-a90d3842b2e9': 'musique',
  'otdb-abcd50db1083': 'nature',
  'otdb-ac65945bfb3e': 'culture-generale',
  'otdb-af9b61f11602': 'gastronomie',
  'otdb-b50bd693139c': 'sciences',
  'otdb-b787a8cd14fa': 'culture-generale',
  'otdb-bc1879be96bc': 'gastronomie',
  'otdb-bd2128f8d4af': 'culture-generale',
  'otdb-bf8d1be8ff4e': 'nature',
  'otdb-c35cd3600f10': 'nature',
  'otdb-c522ca61af73': 'histoire',
  'otdb-c9c9a363bbfd': 'jeux-video',
  'otdb-ca2ff98c40ab': 'gastronomie',
  'otdb-d070b3da4984': 'sciences',
  'otdb-d14e44231eac': 'histoire',
  'otdb-d53a0113a6d9': 'geographie',
  'otdb-d565cb3cfb18': 'geographie',
  'otdb-d582c04bf2cc': 'sciences',
  'otdb-e10828935ccf': 'nature',
  'otdb-e3c4111e567d': 'gastronomie',
  'otdb-e7b48de788da': 'geographie',
  'otdb-e8d26e093a84': 'histoire',
  'otdb-eb03cda2a252': 'sport',
  'otdb-eb53a1e7d8c6': 'gastronomie',
  'otdb-f076937531c5': 'jeux-video',
  'otdb-f0bf2d93021c': 'geographie',
  'otdb-f64adfc90663': 'jeux-video',
  'otdb-f7793d0c4e73': 'nature',
  'otdb-f7eacc61f395': 'culture-generale',
  'otdb-fd4c3f667f1c': 'geographie',
}

// Quiz anglais composés à la main, toutes leurs questions traduites en français. Ordre des questions :
// fixé à la main pour les quiz thématiques, tiré au hasard une fois (Fisher-Yates) pour les mix et
// les quiz par décennie. Thème des mix et des quiz par décennie : culture-generale.
export type QuizPlan = { slug: string; title: string; theme: string; description?: string; questions: string[] }
export const QUIZZES: QuizPlan[] = [
  {
    slug: 'painters-and-masterpieces',
    title: 'Painters and masterpieces',
    theme: 'art',
    description: 'Famous painters, sculptors and works of art.',
    questions: [
      'otdb-0ad9d1a215aa', // Who sculpted the statue of David? => Michelangelo
      'otdb-211fff2b02a5', // Who painted the epic mural Guernica? => Pablo Picasso
      'otdb-dd159d16cad4', // Who painted the Mona Lisa? => Leonardo da Vinci
      'otdb-925ab2fe5863', // Who painted "The Scream"? => Edvard Munch
      'otdb-c1686c62d3cc', // Who painted "Swans Reflecting Elephants", "Sleep", and "The Persistence of Memory"? => ...
      'otdb-12357890cb45', // Which artist painted “The Treachery of Images,” a painting of a pipe with the descripti...
      'otdb-3d4f755cea13', // Which artist's style was to use small different colored dots to create a picture? => Ge...
      'otdb-8ea0e8bf1026', // Who painted The Starry Night? => Vincent van Gogh
      'otdb-a1c9c58aed62', // What French sculptor designed the Statue of Liberty? => Frédéric Auguste Bartholdi
      'otdb-da8f7cbf7a36', // Which Greek sculptor designed the Athena Parthenos statue inside the Parthenon? => Phidias
      'otdb-e3eee6b7d997', // Which of these paintings did Johannes Vermeer not paint? => Bacchus
      'otdb-0ed981a61b6f', // Which one of these paintings is not by Caspar David Friedrich? => The Black Sea
      'otdb-1f02cb2cb2a7', // Painter Piet Mondrian (1872 - 1944) was a part of what movement? => Neoplasticism
      'otdb-ffc71b129bf3', // Venus of Willendorf is one of the earliest works of art, depicting the planets Mars and...
      'otdb-a3412c0f9437', // Ancient Greek and Roman sculptors often colored their statues. => true
      'otdb-e3bad7278823', // What is the name of the Japanese art of folding paper into decorative shapes and figure...
      'otdb-dd6a1dd8ae03', // What is a fundamental element of the Gothic style of architecture? => pointed arch
      'otdb-ed3d318e0ffd', // What was the first successful and commercially viable photographic technique? => The Da...
      'otdb-053cd2db94e2', // The name "Impressionsim" was first given to that art movement by a critic's satirical r...
      'otdb-7eb9f808bbd9', // Which one of these colors are not featured in Mondrian's Broadway Boogie-Woogie? => Green
    ],
  },
  {
    slug: 'film',
    title: 'Film',
    theme: 'cinema',
    description: 'Classic films, directors and stars.',
    questions: [
      'otdb-6d581851331a', // Who directed the movies "Pulp Fiction", "Reservoir Dogs" and "Django Unchained"? => Que...
      'otdb-0cfdbf597489', // Han Solo's co-pilot and best friend, "Chewbacca", is an Ewok. => false
      'otdb-a2e941f44288', // In the original Star Wars trilogy, David Prowse was the actor who physically portrayed ...
      'otdb-90b23e3c233f', // What was Dorothy's surname in 'The Wizard Of Oz'? => Gale
      'otdb-6267b7f0adec', // What was Marilyn Monroe`s character's first name in the film "Some Like It Hot"? => Sugar
      'otdb-448bd9b4f3ab', // Velma Kelly and Roxie Hart are the protagonists of which Oscar winning movie? => Chicago
      'otdb-0cbf5ab82786', // What film did James Cameron's Avatar dethrone as the highest-grossing film ever? => Tit...
      'otdb-01ee9af0f4df', // The film "2001: A Space Odyssey" was released on December 31st, 2000. => false
      'otdb-2e0223c61a14', // Which was the first of Alfred Hitchcock's movies to be filmed in colour? => Rope
      'otdb-f9411cf7bacd', // Which of the following James Bond villains is not affiliated with the SPECTRE organizat...
      'otdb-10d7ee9f7658', // What type of cheese, loved by Wallace and Gromit, had it's sale prices rise after their...
      'otdb-7dd3384fefcc', // Which town is the setting for the Disney movie The Love Bug (1968)? => San Francisco
      'otdb-83fb611e799f', // In "The Hobbit," who was head of the White Council? => Saruman
      'otdb-fdfb5113a762', // Sean Connery wasn't in "Indiana Jones and the Kingdom of the Crystal Skull" because he ...
      'otdb-a565849aa019', // In which 1955 film does Frank Sinatra play Nathan Detroit? => Guys and Dolls
      'otdb-263226f6aa90', // Who played Baron Victor Frankestein in the 1957 Hammer horror film "The Curse of Franke...
      'otdb-e1b21408b87f', // In the 1964 film "Zulu", what song does the British Army company sing before the final ...
      'otdb-68fa4b76fb60', // George Lucas directed the entire original Star Wars trilogy. => false
    ],
  },
  {
    slug: 'movie-trivia',
    title: 'Movie trivia',
    theme: 'cinema',
    description: 'Lesser-known facts about cult and popular films.',
    questions: [
      'otdb-30728241f068', // The movie "Tron" received an Oscar nomination for Best Visual Effects. => false
      'otdb-68b5cab9a7a2', // The original ending of "Little Shop Of Horrors" has the plants taking over the world. =...
      'otdb-88ba3faade98', // In what year was the movie "Police Academy" released? => 1984
      'otdb-fba3285a9ba0', // What was the name of the protagonist in the movie Commando (1985)? => John Matrix
      'otdb-4ef95c765de0', // The 1996 film 'Fargo' is primarily set in which US state? => Minnesota
      'otdb-cd1a2252e968', // What is the name of the fictional retro-mod band starring Austin Powers as the lead voc...
      'otdb-d448aebcb61e', // Which of the following films was directed by Ivan Reitman, written by Gary Ross, featur...
      'otdb-983e97b69788', // In the 1992 film "Army of Darkness", what name does Ash give to his double-barreled sho...
      'otdb-85692f147efa', // Which singer is portrayed by Bruce Campbell in the 2002 film 'Bubba Ho-Tep'? => Elvis P...
      'otdb-9cbbfb110614', // In the 2002 film "Kung Pow! Enter the Fist", Master Pain changes his name to what? => B...
      'otdb-c55e946d5c85', // In the film "Requiem for a Dream", what drug does Jared Leto's character get addicted t...
      'otdb-a296303d80ea', // In The Lord of the Rings: The Fellowship of the Ring, which one of the following charac...
      'otdb-13a2fc0467a4', // Which actor plays the role of the main antagonist in the 2011 movie "Tower Heist?" => A...
      'otdb-f99623b87890', // Which of these actors/actresses is NOT a part of the cast for the 2016 movie "Suicide S...
      'otdb-fc99b197e0ba', // Brandon Routh plays the titular character in the movie "John Wick". => false
      'otdb-2ef605496ff2', // Which famous singer was portrayed by actor Kevin Spacey in the 2004 biographical film "...
      'otdb-56f8ffdc7dce', // In the Friday The 13th series, what year did Jason drown in? => 1957
      'otdb-bfa1ad4e00e8', // In the original Star Wars trilogy, Alec Guinness provided the voice for Darth Vader. =>...
      'otdb-3c441a5ab9e5', // Which animated film did Steven Lisberger direct in 1980 before going on to direct Tron?...
      'otdb-4c001279307e', // Which one of these action movies are shot entirely in one take? => Victoria
    ],
  },
  {
    slug: 'music',
    title: 'Music',
    theme: 'musique',
    description: 'Rock and pop bands, singers and songs.',
    questions: [
      'otdb-11009659847f', // Ozzy Osbourne was the lead singer for what metal band? => Black Sabbath
      'otdb-152ff8ddf565', // Which member of "The Beatles" narrated episodes of "Thomas the Tank Engine"? => Ringo S...
      'otdb-2268e6c88869', // "Make You Feel My Love" was originally written and performed by which singer-songwriter...
      'otdb-2499893a8ca4', // "Hallelujah" is a song written by which Canadian recording artist? => Leonard Cohen
      'otdb-25a2498a9b38', // Who had a 1969 top 5 hit with the song, 'A Boy Named Sue'? => Johnny Cash
      'otdb-27961f63be43', // The Rush song "YYZ" derives its name from the IATA aiport identification code for which...
      'otdb-35b6c876eade', // According to a Beatles song, who kept her face in a jar by the door? => Eleanor Rigby
      'otdb-7b8a87820a79', // Who is the vocalist and frontman of rock band "Guns N' Roses"? => Axl Rose
      'otdb-7baa79c65a3d', // What band featured Sting, Stewart Copeland and Andy Summers? => The Police
      'otdb-94c20dcce170', // Nick Mason is the only member to appear on every Pink Floyd album. => true
      'otdb-3e27619bc27c', // "The Division Bell" is the final album of the progressive rock band Pink Floyd. => false
      'otdb-e0d39b666c82', // Which country does the band Rammstein hail from? => Germany
      'otdb-7dc8f10d186c', // From which country does the piano originate? => Italy
      'otdb-d9608f84014c', // Which term best describes the connection of two sections of a musical piece through a t...
      'otdb-f6bbbabeef2d', // The 1952 musical composition 4'33", composed by prolific American composer John Cage, i...
      'otdb-eda226e36f6e', // Which artists' version of the song "The Tide is High" came first? => The Paragons
      'otdb-5ecf956e01a0', // Daft Punk originated in France. => true
      'otdb-22a9112ede8d', // Which of these is NOT the name of an album released by English singer-songwriter Adele?...
      'otdb-b4b03ae9fbd9', // Who sung the opening theme song to the 1995 James Bond film 'Goldeneye'? => Tina Turner
      'otdb-edb9bf4cb67a', // Who is the frontman of Muse? => Matt Bellamy
    ],
  },
  {
    slug: 'music-trivia',
    title: 'Music trivia',
    theme: 'musique',
    description: 'Bands, rappers and albums, from rock to hip hop.',
    questions: [
      'otdb-0f5def660039', // What year was Weezer's album "Pinkerton" released? => 1996
      'otdb-72c7001a4c86', // Who is the lead singer of Silverchair? => Daniel Johns
      'otdb-b97c0a3a4653', // Who was the lead singer and frontman of rock band R.E.M? => Michael Stipe
      'otdb-f58e42cac2ce', // Who is the founder and leader of industrial rock band, 'Nine Inch Nails'? => Trent Reznor
      'otdb-a7661b4e9865', // According to the American rapper Nelly, what should you do when its hot in here? => Tak...
      'otdb-c8db40a80c0b', // Who is the singer for Fall Out Boy? => Patrick Stump
      'otdb-f06671b0f7d5', // Which of these is the name of an American psychedelic rock band formed in 2002 by Benja...
      'otdb-c86c65a64b44', // What French artist/band is known for playing on the midi instrument "Launchpad"? => Madeon
      'otdb-0806098edbef', // What is the real name of American rapper Pitbull? => Armando Christian Pérez
      'otdb-0d36e1790a65', // The country song “A Boy Named Sue” was written by Shel Silverstein. => true
      'otdb-0f05cba52747', // What is the relationship between the band members of American rock band King of Leon? =...
      'otdb-282e7961545e', // In what year was Taylor Swift born? => 1989
      'otdb-2e9618b6e757', // What was the name of the hip hop group Kanye West was a member of in the late 90s? => T...
      'otdb-965552a44be8', // Muse is a British (English) rock band => true
      'otdb-bec5a267156f', // Lead Singer Rivers Cuomo of American rock band Weezer attended Harvard. => true
      'otdb-e5707637bd8b', // The band "Panic! At the Disco" has released 4 albums total => false
    ],
  },
  {
    slug: 'sports',
    title: 'Sports',
    theme: 'sport',
    description: 'Rules, records and champions across many sports.',
    questions: [
      'otdb-2230d0d158b7', // Which of the following sports is not part of the triathlon? => Horse-Riding
      'otdb-28832b7ed7e6', // In a game of snooker, what colour ball is worth 3 points? => Green
      'otdb-2af5adaa4ea2', // What is the name of the "tool" used to hit the white ball in snooker or billiards? => Cue
      'otdb-7bea892b6275', // In what sport is a "shuttlecock" used? => Badminton
      'otdb-5a2c1541cdec', // Who is often called "the Maestro" in the men's tennis circuit? => Roger Federer
      'otdb-64752dea0c4b', // Which darts player has won the most World Championship titles? => Phil Taylor
      'otdb-6a4d965e4d61', // Who was the first footballer to score 200 goals in the English Premier League? => Alan ...
      'otdb-739bdef0978c', // How many premier league trophies did Sir Alex Ferguson win during his time at Mancheste...
      'otdb-779db15646ec', // Which country did Kabaddi, a contact sport involving tackling, originate from? => India
      'otdb-8a8feca898f6', // How many players are there in an association football/soccer team? => 11
      'otdb-993af82a781c', // Who has played the most tournaments on the Brazilian national soccer team? => Cafu
      'otdb-a9462bece906', // What is the highest belt you can get in Taekwondo? => Black
      'otdb-c46857157256', // What team did England beat in the semi-final stage to win in the 1966 World Cup final? ...
      'otdb-c4ab3dceeb40', // Which of these European cities was the first to host the modern Summer Olympic Games th...
      'otdb-c81573588995', // Which of these track-and-field events is NOT included in the Olympic men's decathlon? =...
      'otdb-cab269c89fa1', // Tennis was once known as Racquetball. => false
      'otdb-cd8ceab17f1b', // Who has played the most tournaments in the German national soccer team? => Lothar Matthäus
      'otdb-d6e431b2503c', // Which country hosted the 2020 Summer Olympics? => Japan
      'otdb-eb03cda2a252', // Bob and Mike Bryan were well known brothers in which sport? => Tennis
      'otdb-5734b39a9423', // In Formula 1, the Virtual Safety Car was introduced following the fatal crash of which ...
    ],
  },
  {
    slug: 'sports-trivia',
    title: 'Sports trivia',
    theme: 'sport',
    description: 'Football clubs, motorsport and other sporting facts.',
    questions: [
      'otdb-1c00951c9376', // Who is regarded as the best Romanian footballer of all time? => Gheorghe Hagi
      'otdb-24ceef66ff94', // "Stadium of Light" is the home stadium for which soccer team? => Sunderland FC
      'otdb-2619bd2894fb', // How many scoring zones are there on a conventional dart board? => 82
      'otdb-30d5462475b2', // Soccer player Cristiano Ronaldo opened a museum dedicated to himself. => true
      'otdb-346c10b9e771', // In association football, or soccer, a corner kick is when the game restarts after someo...
      'otdb-42d5a18688d5', // Etihad Stadium is the home stadium for which team? => Manchester City
      'otdb-82adace5f362', // Formula E is an auto racing series that uses hybrid electric race cars. => false
      'otdb-89a263bb2a6a', // On a dartboard, what number is directly opposite No. 1? => 19
      'otdb-9d9c33228194', // Which of these Russian cities did NOT contain a stadium that was used in the 2018 FIFA ...
      'otdb-a91911924f38', // Which English football team is nicknamed 'The Tigers'? => Hull City
      'otdb-b79df42b6ba8', // What is Tiger Woods' all-time best career golf-score? => 61
      'otdb-df7b2e8fcf25', // Which of these English football clubs is based in Liverpool? => Everton
      'otdb-e8e1a671b76c', // There are a total of 20 races in Formula One 2016 season. => false
      'otdb-f44781c6f16d', // Which player has scored the most goals in the England Premier League (EPL)? => Alan She...
      'otdb-f4734870c4a9', // Which country produced football players such as Cafu, Roberto Carlos and Pelé? => Brazil
      'otdb-8e12836b92da', // Who did Steven Gerrard win the Champions League with? => Liverpool
      'otdb-3561a5c3f7c4', // In 2016, who won the Formula 1 World Constructor's Championship for the third time in a...
      'otdb-8e55ce07f09b', // Who won the 2018 Monaco Grand Prix? => Daniel Ricciardo
      'otdb-22a874e1cfab', // The Mazda 787B won the 24 Hours of Le Mans in what year? => 1991
    ],
  },
  {
    slug: 'history',
    title: 'History',
    theme: 'histoire',
    description: 'Key dates, battles and figures of world history.',
    questions: [
      'otdb-0dee9264fb43', // Who led France during the "Reign of Terror" ? => Maximilien Robespierre
      'otdb-0f296a474252', // What is the name of the Boeing B-29 that dropped the 'Little Boy' atomic bomb on Hirosh...
      'otdb-12064ee25495', // The RMS Titanic sunk during her maiden voyage from Southampton, England to which Americ...
      'otdb-1bd8709562c9', // In what year did the First World War end? => 1918
      'otdb-2c9a5dbf426e', // What happened on June 6, 1944? => D-Day
      'otdb-362fb3ebc531', // What year did the Battle of Agincourt take place? => 1415
      'otdb-60919da3e1b2', // Who crowned Charlemagne as Holy Roman Emperor on Christmas Day in 800? => Pope Leo III
      'otdb-650cc9c6c34f', // Which famous world leader is famed for the saying, "Let them eat cake", yet is rumored ...
      'otdb-6fa907dc807a', // Who was the Prime Minister of the United Kingdom for most of World War II? => Winston C...
      'otdb-735502f5eea4', // In what year did the Wall Street Crash take place? => 1929
      'otdb-7371e6dc4c82', // What was the name of the chemical that was dropped on Vietnam during the Vietnam war? =...
      'otdb-84f0b8a3d2e6', // In which year was Constantinople conquered by the Turks? => 1453
      'otdb-b6ee33ab848f', // After his loss at the Battle of Waterloo, Napoleon Bonaparte was exiled to which island...
      'otdb-b74fe3e23939', // Which country gifted the Statue of Liberty to the United States of America? => France
      'otdb-ac577bb281e8', // What was the code name for the German invasion of the Soviet Union in WW2? => Operation...
      'otdb-c14561bdb39f', // Where was Abraham Lincoln when he was assassinated by John Wilkes Booth in 1865? => At ...
      'otdb-f7875f9c719b', // How was Socrates executed? => Poison
      'otdb-2ac21a16d90a', // Pol Pot was the former dictator of which country? => Cambodia
      'otdb-948960cba94b', // When was the People's Republic of China founded? => October 1, 1949
      'otdb-713cf859de85', // How many manned moon landings have there been? => 6
    ],
  },
  {
    slug: 'through-the-ages',
    title: 'Through the ages',
    theme: 'histoire',
    description: 'From ancient empires to the 20th century.',
    questions: [
      'otdb-0129a7f88a98', // What nationality was sultan Saladin? => Kurdish
      'otdb-0a1879139f41', // There are 13 months in the Ethiopian calendar. => true
      'otdb-1eef60fbe546', // A collection of Sanskrit hymns and verses known as the Vedas are sacred texts in what r...
      'otdb-27dc100367c8', // Which English king was married to Eleanor of Aquitaine? => Henry II
      'otdb-283fdb329c50', // The Emus won the Great Emu War of 1932. => true
      'otdb-389189040353', // Which king was killed at the Battle of Bosworth Field in 1485? => Richard III
      'otdb-3c4e4a1620b0', // What micro-state is considered to have the oldest constitution still in effect? => San ...
      'otdb-475176886ac9', // Who was a military strategist in the Eastern Zhou period? => Sun Tzu
      'otdb-482a7f8e6a15', // During the Mongolian invasions of Japan, what were the Mongol boats mostly stopped by? ...
      'otdb-4ccfce05edfd', // United States President John F. Kennedy was assassinated during his presidential motorc...
      'otdb-4e263388396a', // When was the Gregorian Calendar first adopted? => 1582
      'otdb-6532da3c258d', // The Ottoman Empire was dissolved after their loss in which war? => World War I
      'otdb-68057e9d8869', // In the War of the Pacific (1879 - 1883), Bolivia lost its access to the Pacific Ocean a...
      'otdb-72288eb09c8a', // Who was the first ruler of Haiti after the country had gained its independence? => Jean...
      'otdb-8ccfeb49468d', // Adolf Hitler was tried at the Nuremberg trials. => false
      'otdb-9619b06bd02f', // Oxford University is older than the Aztec Empire. => true
      'otdb-a6536abb4cce', // The majority of people that lived under the Byzantine Empire called themselves Romans. ...
      'otdb-afa5e027b172', // Against which country did the Dutch Republic fight the Eighty Years' War? => Spain
      'otdb-b02679bdc44b', // Martin Luther King Jr. and Anne Frank were born the same year. => true
      'otdb-f43cfe1fa0f6', // The Bohemian Revolt (1618-1620) started after Protestants in Prague did what to their C...
    ],
  },
  {
    slug: 'geography',
    title: 'Geography',
    theme: 'geographie',
    description: 'Capitals, landmarks, seas and mountains.',
    questions: [
      'otdb-093fc816e5eb', // What is the capital of India? => New Delhi
      'otdb-1d737639c45f', // What is the name of the peninsula containing Spain and Portugal? => Iberian Peninsula
      'otdb-346b2f4a8147', // What is the largest country in the world? => Russia
      'otdb-29510c243d0a', // What is the capital of Finland? => Helsinki
      'otdb-48fee338470c', // What is the capital of Denmark? => Copenhagen
      'otdb-572b001645d7', // Which is the smallest country in the world? => Vatican City
      'otdb-5edeb288d9cf', // Nova Scotia is on the east coast of Canada. => true
      'otdb-708ca8904460', // In which Indian city can the Taj Mahal be found? => Agra
      'otdb-7824bcace715', // What is the capital of Spain? => Madrid
      'otdb-915ae24c6e90', // Which ocean borders the west coast of the United States? => Pacific
      'otdb-9618c355b1f9', // Which canal connects the Mediterranean Sea with the Red Sea? => Suez Canal
      'otdb-a64abeb66e74', // Where would you find the "Spanish Steps"? => Rome, Italy
      'otdb-c233f2c2e7dd', // Which area of Eastern Europe is famous for its association with vampires? => Transylvania
      'otdb-da02934a343b', // Ottawa is the capital of Canada. => true
      'otdb-f925d2e7fb0d', // On which continent does the Andes mountain range lie? => South America
      'otdb-e53e4ce34812', // Which stretch of water connects the Atlantic Ocean to the Mediterranean Sea? => Strait ...
      'otdb-df994f5cfa0f', // What is the largest lake in the African continent? => Lake Victoria
      'otdb-376eace346da', // What city is the Terracotta Army located in? => Xi'an
      'otdb-1cd4172ba8c3', // The Space Needle is located in which city? => Seattle
      'otdb-970c51eb946c', // Tokyo is the capital of Japan. => true
    ],
  },
  {
    slug: 'around-the-world',
    title: 'Around the world',
    theme: 'geographie',
    description: 'Countries, cities and borders around the globe.',
    questions: [
      'otdb-06e72217a34e', // What is the capital of Senegal? => Dakar
      'otdb-09c4b49e009e', // What is Russia's second-largest city? => Saint Petersburg
      'otdb-232a098b7803', // The formerly East-Prussian city of Königsberg is known as which Russian City today? => ...
      'otdb-2946a2afd207', // How many countries does the United States share a land border with? => 2
      'otdb-36d17a8a52f4', // Greenland is almost as big as Africa. => false
      'otdb-3e9d6566d631', // The Southeast Asian island of Borneo is politically divided among 3 countries. => true
      'otdb-43f26954c3d1', // The White Cliffs of Dover is located in which country? => United Kingdom
      'otdb-4d3dd54cd182', // What country is the second largest in the world by area? => Canada
      'otdb-5c831f731398', // What is the capital of Estonia? => Tallinn
      'otdb-60ffb01b4b7b', // Which country has the abbreviation "CH"? => Switzerland
      'otdb-78f8a4d9c51e', // What is the smallest country in South America by area? => Suriname
      'otdb-87d40d274509', // Which of these Mediterranian islands is under the sovereign rule of France? => Corsica
      'otdb-89cf9c825cb7', // Hungary is the only country in the world beginning with H. => false
      'otdb-c2dc0fd0b811', // Bridgetown is the capital of which island country in the Carribean? => Barbados
      'otdb-ca116bab287a', // The historical city Timbuktu is located in which West African country? => Mali
      'otdb-d15a71a9b7b4', // Which country has three capital cities? => South Africa
      'otdb-d2caefd849e2', // What is the name of the former country that was succeeded by countries such as Serbia, ...
      'otdb-d69fae85c81a', // What is the Polish city known to Germans as Danzig? => Gdańsk
      'otdb-db047052b22e', // The capital of Brazil is Rio de Janeiro. => false
      'otdb-f860ef14255f', // Which German city is located on the River Isar? => Munich
    ],
  },
  {
    slug: 'books',
    title: 'Books',
    theme: 'litterature',
    description: 'Famous authors, novels and characters.',
    questions: [
      'otdb-19926196cd34', // George Orwell wrote this book, which is often considered a statement on government over...
      'otdb-200487a8a502', // Who was the original author of Frankenstein? => Mary Shelley
      'otdb-20091fd561d0', // What is the name of Sherlock Holmes's brother? => Mycroft Holmes
      'otdb-3d5767d53e30', // The book "The Little Prince" was written by... => Antoine de Saint-Exupéry
      'otdb-465651f04dc8', // What is the name of the three headed dog in Harry Potter and the Sorcerer's Stone? => F...
      'otdb-48d86b7ae2b9', // "Green Eggs And Ham" is a book by which author? => Dr. Seuss
      'otdb-520f03d31f1a', // Who wrote "Harry Potter"? => J.K. Rowling
      'otdb-6e19074f2ff4', // What was the name of Captain Nemo's submarine in "20,000 Leagues Under the Sea"? => The...
      'otdb-825fad4a4376', // Which famous spy novelist wrote the childrens' story "Chitty-Chitty-Bang-Bang"? => Ian ...
      'otdb-96a05205906a', // Which classic book opens with the line "Call me Ishmael"? => Moby Dick
      'otdb-a9a219e9cc53', // Who wrote "A Tale of Two Cities"? => Charles Dickens
      'otdb-aa91f7257840', // What is the name of the protagonist of J.D. Salinger's novel Catcher in the Rye? => Hol...
      'otdb-b068a9db8eea', // Who was the author of the 1954 novel, "Lord of the Flies"? => William Golding
      'otdb-d81d656cf7e7', // Under what pseudonym did Stephen King publish five novels between 1977 and 1984? => Ric...
      'otdb-e3e2514b4418', // This play is generally considered to be the most adaptable of Shakespeare’s works, and ...
      'otdb-eb2bb4827a0a', // What is the title of the first Sherlock Holmes book by Arthur Conan Doyle? => A Study i...
      'otdb-f2d10153e681', // Who is the author of the "A Song of Ice and Fire" book series, starting with "A Game of...
      'otdb-e6cf9491aa9d', // In the "The Hobbit", who kills Smaug? => Bard
      'otdb-18e2cb543939', // According to The Hitchhiker's Guide to the Galaxy book, the answer to life, the univers...
      'otdb-61a32e8f4243', // In Rudyard Kipling's "The Jungle Book", what type of snake was Kaa? => Python
    ],
  },
  {
    slug: 'novels-and-characters',
    title: 'Novels and characters',
    theme: 'litterature',
    description: 'Classic novels and the characters who live in them.',
    questions: [
      'otdb-02d87aa159d2', // Which American author was also a budding travel writer and wrote of his adventures with...
      'otdb-0cbf2c2b87d7', // What was the name of the Mysterious Island, in Jules Verne's "The Mysterious Island"? =...
      'otdb-10d05362143c', // Abel Magwitch is a character from which Charles Dickens novel? => Great Expectations
      'otdb-19b5c2e0b2d1', // Which classic horror character killed Elizabeth Lavenza? => Frankenstein's Monster
      'otdb-22e8d24d5b1a', // According to Bram Stoker's novel, in which British coastal town did Dracula come ashore...
      'otdb-2d39d38f6074', // In the "Harry Potter" novels, what must a Hogwarts student do to enter the Ravenclaw Co...
      'otdb-347881364e88', // Which of the following authors was not born in England? => Arthur Conan Doyle
      'otdb-5eb44b56b155', // By what nickname is Jack Dawkins known in the Charles Dickens novel, 'Oliver Twist'? =>...
      'otdb-686026876e2c', // In which classic novel by Mark Twain did a beggar and Prince of Wales switch clothes, a...
      'otdb-68b8bb2236a7', // What was the pen name of novelist, Mary Ann Evans? => George Eliot
      'otdb-6c5b974fa618', // How many books are in the Chronicles of Narnia series? => 7
      'otdb-8848a1943da4', // Who wrote the novel "Moby-Dick"? => Herman Melville
      'otdb-8bc5b6452899', // Which poet wrote "The Ballad of Reading Gaol" whilst imprisoned for being gay? => Oscar...
      'otdb-9f04d7b75b3e', // The novel "Jane Eyre" was written by what author? => Charlotte Brontë
      'otdb-b00da953a2eb', // What was the last message of the Dolphins in "The Hitchhiker's Guide to the Galaxy"? =>...
      'otdb-baf8309e802a', // By what name was the author Eric Blair better known? => George Orwell
      'otdb-ce7f1b6ca788', // Which Russian author wrote the epic novel War and Peace? => Leo Tolstoy
      'otdb-e0d70810ca13', // In "Little Women", which of the March sisters married Laurie? => Amy
      'otdb-e681ede2f911', // Where does Stephen King's "IT" take place? => Derry, Maine
      'otdb-e83482a97591', // In the children's book series, where is Paddington Bear originally from? => Peru
    ],
  },
  {
    slug: 'science',
    title: 'Science',
    theme: 'sciences',
    description: 'Chemistry, biology, physics and space.',
    questions: [
      'otdb-19ed50bb4941', // What is the powerhouse of the cell? => Mitochondria
      'otdb-5a268344bf97', // Which element has the chemical symbol 'Fe'? => Iron
      'otdb-5a8e62500b76', // Which gas forms about 78% of the Earth’s atmosphere? => Nitrogen
      'otdb-840e6e4c747c', // The human heart has how many chambers? => 4
      'otdb-9ee4a9a12815', // How many planets are there in the Solar System? => 8
      'otdb-a447ed5a5aee', // What is the chemical symbol for Helium? => He
      'otdb-ad5941b21fc6', // Which planet in the Solar System is the closest to the Sun? => Mercury
      'otdb-e572ba485a98', // What is the hottest planet in the Solar System? => Venus
      'otdb-7ebf5b5a49a1', // What was the name of the first artificial Earth satellite, launched by the Soviet Union...
      'otdb-c3e8918d88be', // Who discovered the Law of Gravity? => Sir Isaac Newton
      'otdb-8a48657e3f15', // What did Gregory Mendel use to test genetic crossovers? => Peas
      'otdb-740e65fc9cff', // Which type of rock is created by intense heat AND pressure? => Metamorphic
      'otdb-43bb0835c1a1', // Which of these bones is hardest to break? => Femur
      'otdb-2be87c4e4d4d', // Who developed the first successful polio vaccine in the 1950s? => Jonas Salk
      'otdb-a114f70d6449', // What is the unit of electrical resistance? => Ohm
      'otdb-26c5aceb5872', // What is the standard SI unit for electric current? => Ampere
      'otdb-99b529fba2ca', // What lies at the center of our galaxy? => A black hole
      'otdb-3636c413fe96', // The Earth and the Moon roughly have the same mass. => false
      'otdb-a38206ed393f', // Water always boils at 100°C, 212°F, 373.15K, no matter where you are. => false
      'otdb-40cd6afdc693', // Approximately what percentage of Earth's atmosphere is Oxygen? => 21%
    ],
  },
  {
    slug: 'computers-and-internet',
    title: 'Computers and the internet',
    theme: 'sciences',
    description: 'Computing basics, programming and tech history.',
    questions: [
      'otdb-0f0c4d005568', // Ada Lovelace is often considered the first computer programmer. => true
      'otdb-3d53b1ba9367', // The C programming language was created by this American computer scientist. => Dennis R...
      'otdb-404e42b2344f', // In computing, how many bits are in a nibble? => 4
      'otdb-449cc58e0e5e', // What is known as "the brain" of the Computer? => Central Processing Unit
      'otdb-5454b6a3a5a2', // What is the commonly used keyboard shortcut for the 'Copy' function on Windows OS? => C...
      'otdb-653e3bb88997', // HTML is what type of language? => Markup Language
      'otdb-8d40cbb05977', // The Windows OS was delevoped by which company? => Microsoft
      'otdb-bfb15a9c125e', // What does the term USB stand for? => Universal Serial Bus
      'otdb-c708f35b9d1d', // RAM stands for Random Access Memory. => true
      'otdb-d1874ab812be', // Which programming language shares its name with an island in Indonesia? => Java
      'otdb-db52410020e1', // Linus Torvalds created Linux and Git. => true
      'otdb-f2ea734fa875', // What amount of bits commonly equals one byte? => 8
      'otdb-f3a52928a44f', // How many values can a single byte represent? => 256
      'otdb-218eae918f1d', // What did the name of the Tor Anonymity Network orignially stand for? => The Onion Router
      'otdb-2daf4206ea7a', // On Twitter, what was the original character limit for a Tweet? => 140
      'otdb-4a32f8e5563f', // The first computer bug was formed by faulty wires. => false
      'otdb-87ba4c74db62', // The ARM computer chip was originally developed by Acorn Computers. => true
      'otdb-031386517d1c', // The NVidia GTX 1080 gets its name because it can only render at a 1920x1080 screen reso...
      'otdb-566743fdf56d', // The 'Raspberry Pi' series of single-board computers were created in the United States. ...
      'otdb-f585f23f6645', // The teapot often seen in many 3D modeling applications is called what? => Utah Teapot
    ],
  },
  {
    slug: 'maths-and-numbers',
    title: 'Maths and numbers',
    theme: 'sciences',
    description: 'Numbers, shapes and famous mathematicians.',
    questions: [
      'otdb-29ac4a588976', // In Roman Numerals, what does XL equate to? => 40
      'otdb-46afbe386b36', // What prime number comes next after 19? => 23
      'otdb-48028082ffc9', // A scalene triangle has two sides of equal length. => false
      'otdb-5d2dabb81b77', // How many degrees make a full circle? => 360
      'otdb-955ff0f53474', // What is the name of a nine sided polygon? => Nonagon
      'otdb-a5bb63acb57e', // How many sides does a heptagon have? => 7
      'otdb-b493dae2e67b', // How many square faces does a cube have? => 6
      'otdb-dab335bde415', // What's the square root of 49? => 7
      'otdb-f5a558a88c93', // How many sides does a trapezium have? => 4
      'otdb-f681167c0207', // How many sides does a Möbius strip have? => 1
      'otdb-fa42d73b88a4', // What is the mathematician Euler's first name? => Leonhard
      'otdb-8be12f3ff33e', // Which greek mathematician ran through the streets of Syracuse naked while shouting "Eur...
      'otdb-8624353db6ec', // A mathematical constant, known as "The Golden Ratio", is most commonly represented by w...
      'otdb-d5de9c4722b9', // What are the first 6 digits of the number "Pi"? => 3.14159
      'otdb-2ab8e02b9cf2', // The sum of any two odd integers is odd. => false
      'otdb-d86dda745c8f', // Zero factorial is equal to zero. => false
      'otdb-27ff243b75c0', // Which of the following famous mathematicians died in a duel at the age of 20? => Galois
      'otdb-a4adcd6ba6a7', // What type of function is x²+2x+1? => Quadratic
      'otdb-ebb12224194b', // Which of the following dice is not a platonic solid? => 10-sided die
      'otdb-b6e94325bd51', // What is the smallest number that can be expressed as the sum of two positive cubes in t...
    ],
  },
  {
    slug: 'animals',
    title: 'Animals',
    theme: 'nature',
    description: 'Mammals, birds, reptiles and other creatures.',
    questions: [
      'otdb-01edffe301a4', // Which breed of dog is traditionally associated with firefighters? => Dalmatians
      'otdb-172a31fabd90', // Which class of animals are newts members of? => Amphibian
      'otdb-447dd0cd845d', // What is the name of a rabbit's abode? => Burrow
      'otdb-55980ed8d8c7', // The Axolotl is an amphibian that can spend its whole life in a larval state. => true
      'otdb-57d1aee55981', // What is the fastest animal? => Peregrine Falcon
      'otdb-7813e2c100b4', // What color/colour is a polar bear's skin? => Black
      'otdb-7fba7be7a147', // Rabbits are rodents. => false
      'otdb-837d0dc0f5d4', // What is the name for a male bee that comes from an unfertilized egg? => Drone
      'otdb-8a407d3c5d7a', // In 2016, the IUCN reclassified the status of Giant Pandas from endangered to vulnerable...
      'otdb-8bcef5e2194b', // Kangaroos keep food in their pouches next to their children. => false
      'otdb-9b7f77cffa4d', // The Platypus is a mammal. => true
      'otdb-a368cba3bd4b', // What are rhino's horn made of? => Keratin
      'otdb-a4a032f5500e', // The internet browser Firefox is named after the Red Panda. => true
      'otdb-ae920814f32b', // Which is the national animal of India? => Tiger
      'otdb-c01f7758852d', // A caterpillar has more muscles than humans do. => true
      'otdb-c49d471ae4d9', // The Killer Whale is considered a type of dolphin. => true
      'otdb-d6595968333b', // Wombats are native to which Country? => Australia
      'otdb-dc9019beb624', // Snakes and lizards are known to flick their tongue, this behavior is to? => Capture sce...
      'otdb-e10828935ccf', // Bulls are attracted to the color red. => false
      'otdb-f0f63deca756', // Hippocampus is the Latin name for which marine creature? => Seahorse
    ],
  },
  {
    slug: 'video-games',
    title: 'Video games',
    theme: 'jeux-video',
    description: 'Classic and modern video games.',
    questions: [
      'otdb-3d869528a1de', // Who is Sonic's sidekick? => Tails
      'otdb-d717907049f4', // What is a Tetris piece called? => Tetromino
      'otdb-e48de694186e', // Super Mario Bros. was the first video game ever created. => false
      'otdb-e23ee4ccf3c9', // Who in this list is one of the co-founders of Valve? => Gabe Newell
      'otdb-290493c71112', // In Half-Life, what is the name of the alien that attaches to heads? => Headcrab
      'otdb-38b691991828', // How many classes are there in Team Fortress 2? => 9
      'otdb-d40fc3644665', // What ingredient is NOT used to craft a cake in Minecraft? => Bread
      'otdb-5fb3198c378a', // M.U.G.E.N. is the name for what type of Game Engine? => Fighting Game
      'otdb-ccee541f9f9b', // The Touhou Project series of games is often associated with which genre? => Shoot 'em up
      'otdb-6de6314240c9', // In the game "Sonic the Hedgehog (1991)" how many chaos emeralds could you collect? => 6
      'otdb-0d55543d8a8f', // What was the first game ever released that ran on the Source engine? => Counter-Strike:...
      'otdb-2bcf0e7abc68', // Gordon Freeman is said to have burnt and destroyed what food in the break room microwav...
      'otdb-1c87cc67d261', // In "Rainbow Six: Siege", which of the following operators cannot breach reinforced wall...
      'otdb-c3ba6d3cad5b', // In Left 4 Dead, which campaign has the protagonists going through a subway in order to ...
      'otdb-f270083bbe29', // In the game "Fire Emblem: Shadow Dragon", what is the central protagonist's name? => Marth
      'otdb-8900afe44478', // In Kingdom Hearts, how many members does Organization XIII have in total? => 14
      'otdb-3e78c8622b56', // In the Pokémon series, which type is Sudowoodo, the Imitation Pokémon? => Rock
      'otdb-48b962eb81ed', // In "Resident Evil 2", what is Leon Kennedy's middle name? => Scott
      'otdb-9e3ac5d63bb6', // In Star Wars: Republic Commando (2005), what is the name of the squad that you play as?...
      'otdb-d685c89034e7', // In the videogame Bully, what is the protagonist's last name? => Hopkins
    ],
  },
  {
    slug: 'gaming-trivia',
    title: 'Gaming trivia',
    theme: 'jeux-video',
    description: 'Characters, studios and details from popular games.',
    questions: [
      'otdb-037289554678', // In World of Warcraft lore, how many siblings does Sylvanas Windrunner have? => 3
      'otdb-f9299759d428', // In World of Warcraft the default UI color that signifies Druid is what? => Orange
      'otdb-1ae05d211545', // What was the name of Sonic the Hedgehog's original human girlfriend? => Madonna
      'otdb-5065cbef75a0', // The names of Roxas's Keyblades in Kingdom Hearts are "Oathkeeper" and "Oblivion". => true
      'otdb-332adacd6a36', // In "Paper Mario: The Thousand Year Door", what is Hooktail's weakness? => The Sound of ...
      'otdb-5d5097eb5f11', // In the PAYDAY series, who is the iconic leader of the PAYDAY gang? => Dallas
      'otdb-619097af447d', // The Ace Attorney trilogy was suppose to end with "Phoenix Wright: Ace Attorney − Trials...
      'otdb-67928a134d79', // The main antagonist in the videogame Saints Row IV is an entity known as The Mastermind...
      'otdb-7d0ad2427301', // The game "Jetpack Joyride" was created by "Redbrick Studios". => false
      'otdb-b7a3dd191d17', // This weapon in Counter-Strike: Global Offensive does not exist in real life. => M4A4
      'otdb-c9ed4aa6c2a8', // Which company is the one responsible for creating the strategy videogame Stellaris? => ...
      'otdb-fcdc1c1d51bc', // Where was the Sniper character in Team Fortress 2 born? => New Zealand
      'otdb-f630bc6dd5a0', // In the Resident Evil series, Leon S. Kennedy is a member of STARS. => false
      'otdb-884950d93345', // In "Katamari Damacy", you control a character known as: => The Prince
      'otdb-d3c7ac697452', // What is the name of the first level in "Call of Duty: World at War"? => Semper Fi
      'otdb-d5a5faf50d36', // What is the AK-47's name in Counter Strike: Source? => CV-47
      'otdb-e01f9734eccc', // In career mode of "Need for Speed: Underground 2", the first car the player can drive i...
      'otdb-92639a891983', // In Overwatch, what is Lúcio's full name? => Lúcio Correia Dos Santos
      'otdb-2d49b96a34f1', // In "Resident Evil 3", how many inventory slots does Jill have at the start of the game?...
      'otdb-6fe3c0843a63', // Which of these symbols can be seen on the shirt of the 1993 video game character, Bubsy...
    ],
  },
  {
    slug: 'general-knowledge',
    title: 'General knowledge',
    theme: 'culture-generale',
    description: 'Everyday facts, languages and currencies.',
    questions: [
      'otdb-052707e1b8a6', // Rolex is a company that specializes in what type of product? => Watches
      'otdb-0e4e4043cb3c', // "A3", "B1", and "Legal" are typical names of sizes for what object? => Paper
      'otdb-0ff39d4f19b6', // The Original Jack-o-Lanterns were actually hollowed out turnips. => true
      'otdb-20d9976c9f51', // Kissing someone for one minute burns about 2 calories. => true
      'otdb-230b8ef58364', // What do sailors call the front of a boat? => Bow
      'otdb-2ad26c2bcad9', // Five dollars is worth how many nickels? => 100
      'otdb-3291e904c108', // Which American president appears on a one dollar bill? => George Washington
      'otdb-343661d9214f', // The term "Spam" came before the food product "Spam". => false
      'otdb-45be09803d4e', // What country does sushi & karaoke come from? => Japan
      'otdb-463875432d3a', // What direction does the Statue of Liberty face? => Southeast
      'otdb-52f1cb662555', // What do the Dutch call their language? => Nederlands
      'otdb-6b98a9b2b279', // Which river flows through the Scottish city of Glasgow? => Clyde
      'otdb-76e3b6a86b9a', // Who is the origin of the quote "What doesn't kill you makes you stronger"? => Friedrich...
      'otdb-94f99d7b3982', // All Souls and Merton are constituent colleges of what university? => Oxford
      'otdb-aed2f8b8e80f', // Which language is most widely spoken in Switzerland? => German
      'otdb-b59ce2c960ab', // What was the first ever London Underground line to be built? => Metropolitan Line
      'otdb-c0de5e707233', // Ecuador uses the Mexican Peso as its currency. => false
      'otdb-cfd2d4d720d5', // What is the currency of Poland? => Złoty
      'otdb-db863aa53f9b', // What does a milliner make and sell? => Hats
      'otdb-fcfe7eb0a77e', // What is the shape of the toy invented by Hungarian professor Ernő Rubik? => Cube
    ],
  },
  {
    slug: 'food-and-drink',
    title: 'Food and drink',
    theme: 'gastronomie',
    description: 'Dishes, ingredients and drinks from around the world.',
    questions: [
      'otdb-156bcc53194d', // What fruit is a traditional ingredient of a Black Forest Gateau? => Cherries
      'otdb-32dfe9ed2fef', // What nation produces roughly 40% of the world’s vanilla? => Madagascar
      'otdb-7c50e0e0f244', // What is the name given to Indian food cooked over charcoal in a clay oven? => Tandoori
      'otdb-92eb5125f007', // What style of beer will typically have a higher than average hop content? => India Pale...
      'otdb-a64dba54c749', // What nuts are used in the production of marzipan? => Almonds
      'otdb-af9b61f11602', // Instant mashed potatoes were invented by Canadian Edward Asselbergs in 1962. => true
      'otdb-bc1879be96bc', // Who invented the first ever chocolate bar, in 1847? => Joseph Fry
      'otdb-ca2ff98c40ab', // Nutella is produced by the German company Ferrero. => false
      'otdb-e3c4111e567d', // The dish Fugu, is made from what family of fish? => Pufferfish
      'otdb-eb53a1e7d8c6', // What alcoholic drink is mainly made from juniper berries? => Gin
    ],
  },
  {
    slug: 'culture-mix-1',
    title: 'Culture mix #1',
    theme: 'culture-generale',
    description: 'A mix of geography, history, science, nature, books and art questions.',
    questions: [
      'otdb-862aa8926bd9', // What is the world's oldest known piece of fiction? => Epic of Gilgamesh
      'otdb-5a5fd49201a7', // How many soccer players should be on the field at the same time? => 22
      'otdb-42ca7eb8bb08', // What is another name for La Gioconda / La Joconde? => The Mona Lisa
      'otdb-abcd50db1083', // What is the largest living species of penguin? => Emperor
      'otdb-0741d591f209', // The painting "Guernica" by Pablo Picasso expressed emotions of dread in response to whi...
      'otdb-2599d598ad3e', // Coulrophobia is the irrational fear of what? => Clowns
      'otdb-e8d26e093a84', // When was the Declaration of Independence approved by the Second Continental Congress? =...
      'otdb-9704a17e4f77', // Which of the following is NOT a venomous snake? => Reticulated python
      'otdb-4178f636400b', // In the Super Mario Bros. Movie (2023), who plays Toad? => Keegan-Michael Key
      'otdb-e6d85b2d35fa', // Who wrote the children's story "The Little Match Girl"? => Hans Christian Andersen
      'otdb-193c690740c9', // What is the colour of unoxidized blood? => Red
      'otdb-13441e05cea3', // What's the first National Park designated in the United States? => Yellowstone
      'otdb-7dd44ebccdca', // Which country was NOT part of the Soviet Union? => Romania
      'otdb-3404f5b69fbd', // What is the name of Poland in Polish? => Polska
      'otdb-8d62f2070dca', // When did construction of the Suez Canal finish? => 1869
      'otdb-9a434d9626bb', // Which US state is nicknamed "The Golden State"? => California
      'otdb-563a9a53de95', // How many moons does the Earth have? => 1
      'otdb-ca9bec94ddd3', // How would one say goodbye in Spanish? => Adiós
      'otdb-cb638e5b5d6a', // The idea of Socialism was articulated and advanced by whom? => Karl Marx
      'otdb-e846d67ed6c1', // What mineral has the lowest number on the Mohs scale? => Talc
    ],
  },
  {
    slug: 'culture-mix-2',
    title: 'Culture mix #2',
    theme: 'culture-generale',
    description: 'A mix of geography, history, science, books, art and sport questions.',
    questions: [
      'otdb-35a8f0d39774', // Which company did Valve cooperate with in the creation of the Vive? => HTC
      'otdb-e16d466e2294', // Llanfair­pwllgwyngyll­gogery­chwyrn­drobwll­llan­tysilio­gogo­goch is located on which ...
      'otdb-e2f77f14a879', // In which video game did Michael Fassbender star? => Fable 3
      'otdb-9a6358e21825', // The novel "Of Mice And Men" was written by what author? => John Steinbeck
      'otdb-0e270a89b6c0', // Tetsuya Fujita was a scientist that developed the scale for which natural disaster? => ...
      'otdb-a93e0fc1da45', // What was the name of the first permanent English settlement in America? => Jamestown
      'otdb-4cdc0208eb4b', // Which part of the body does glaucoma affect? => Eyes
      'otdb-2bb62115b3fc', // What nationality was the famous artist Pablo Picasso? => Spanish
      'otdb-91ac768ab36b', // Which of these animals are not real? => Nemean Lion
      'otdb-1bc335215609', // What is the name of the author of book series 'Percy Jackson'? => Rick Riordan
      'otdb-732b211f8643', // What national team won the first UEFA Nations League? => Portugal
      'otdb-aa8f23a28a4e', // What country is not a part of Scandinavia? => Finland
      'otdb-0d87d634590a', // What are the scales on all snakes and most lizards are made of? => Keratin
      'otdb-ba22c6e0fa70', // In the 2002 film "Kung Pow! Enter the Fist", why was Wimp Lo purposely trained wrong? =...
      'otdb-98b2c9745ea5', // Which state of the United States is the smallest? => Rhode Island
      'otdb-7591f4c26fcd', // An organism described as "heliotropic" has a tendancy to move towards which of these th...
      'otdb-6b4b8f8667e1', // What color is produced by mixing black and white? => Grey
      'otdb-d14e44231eac', // What was the nickname given to the Hughes H-4 Hercules, a heavy transport flying boat w...
      'otdb-b495fe142388', // The likeness of which president is featured on the rare $2 bill of USA currency? => Tho...
      'otdb-1fd50ff6f75d', // When did the United States formally declare war on Japan, entering World War II? => Dec...
    ],
  },
  {
    slug: 'culture-mix-3',
    title: 'Culture mix #3',
    theme: 'culture-generale',
    description: 'A mix of geography, history, science, nature, books and art questions.',
    questions: [
      'otdb-bd49c696a981', // Which is the largest of these 4 islands? => Borneo
      'otdb-8288be0d6510', // Who painted the Sistine Chapel? => Michelangelo
      'otdb-d44bbc8f1fe6', // Prior to 2018, which car company is the only Japanese company which won the 24 Hours of...
      'otdb-3fb33d531d0f', // Which artist is famous for cutting off his ear? => Vincent van Gogh
      'otdb-f7eacc61f395', // What year was the first Pizza Hut restaurant opened? => 1958
      'otdb-667fc853c9f7', // The book 1984 was published in 1949. => true
      'otdb-a70c06b7e390', // Which chemical element has the lowest boiling point? => Helium
      'otdb-5f7859cc2457', // When was the Grand Patriotic War in the USSR concluded? => May 9th, 1945
      'otdb-e4d2d9edfdc3', // Human cells typically have how many copies of each gene? => 2
      'otdb-5ef7614b707e', // Which of these countries is not a United Nations member state? => Niue
      'otdb-c23251c14237', // Miami is Florida's largest city. => false
      'otdb-2a67a99cd84b', // Where is the "Sonoran Desert" located? => North America
      'otdb-81ae91b33b7a', // How many moons does Pluto have? => Five
      'otdb-d3ec6541d5d2', // Who was the Prime Minister of Japan when Japan declared war on the US? => Hideki Tojo
      'otdb-31a3c42d587e', // Cucumbers are usually more than 90% water. => true
      'otdb-909701a9bf7a', // What part of the brain takes its name from the Greek for seahorse? => Hippocampus
      'otdb-4faaa6a3d415', // What is the Spanish word for "donkey"? => Burro
      'otdb-4af4e403bb98', // What type of creature is a Bonobo? => Ape
      'otdb-0eb4303f71c7', // Which of these founding fathers of the United States of America later became president?...
      'otdb-d7aff140508b', // Which famous book is sub-titled 'The Modern Prometheus'? => Frankenstein
    ],
  },
  {
    slug: 'culture-mix-4',
    title: 'Culture mix #4',
    theme: 'culture-generale',
    description: 'A mix of geography, history, science, nature, books and film questions.',
    questions: [
      'otdb-dbaa3244600f', // In "ALF", what was ALF's real name? => Gordon Shumway
      'otdb-e25c0f1fae41', // How many Harry Potter books are there? => 7
      'otdb-6f47d688ac0b', // Which artist painted the late 15th century mural 'The Last Supper'? => Leonardo da Vinci
      'otdb-f70ac70311a1', // What nationality was the famous artist Van Gogh? => Dutch
      'otdb-f7793d0c4e73', // Male pandas do handstands while urinating on trees. => true
      'otdb-b4e7e431a3df', // The Cold War ended with Joseph Stalin's death. => false
      'otdb-16785d792b30', // There exists an island named "Java". => true
      'otdb-f179a758be81', // Which country claims ownership of the disputed state Kosovo? => Serbia
      'otdb-a65b7cf33a2b', // Which dog breed is named after a region in Croatia => Dalmatian
      'otdb-8c9b9f2c9145', // What is the domain name for the country Tuvalu? => .tv
      'otdb-c7dc508c1114', // The country of Belize borders which country? => Guatemala
      'otdb-a8c1f13c4897', // When did the Byzantine Empire collapse? => 1453
      'otdb-6f3715529b1c', // The fourth funnel of the RMS Titanic was fake designed to make the ship look more power...
      'otdb-e7c00ba0d9e9', // What is the romanized Russian word for "winter"? => Zima
      'otdb-4303d31b2723', // How old is the universe? => 13.8 Billion Years
      'otdb-cebd9759c538', // Who wrote the 1967 horror novel "Rosemary's Baby"? => Ira Levin
      'otdb-3016d2e64d33', // How much radiation does a banana emit? => 0.1 Microsievert
      'otdb-5539e624a989', // Which team was the 2014-2015 NBA Champions? => Golden State Warriors
      'otdb-2cf90c158733', // What common name is given to the medial condition, tibial stress syndrome (MTSS)? => Sh...
      'otdb-02fb118da74a', // In DC comics where does the Green Arrow (Oliver Queen) live? => Star City
    ],
  },
  {
    slug: 'the-70s',
    title: 'The 70s',
    theme: 'culture-generale',
    description: 'Films, music and events from the 1970s.',
    questions: [
      'otdb-4fefa79ecac8', // According to their 1974 hit, what were Brownsville Station doing "In The Boys' Room"? =...
      'otdb-21bf82c94f48', // What was the name of the actor who played Leatherface in the 1974 horror film, The Texa...
      'otdb-ebdfbb9e20ae', // How many French Open's did Björn Borg win? => 6
      'otdb-49e43603aa1c', // In what year was the first eSports competition? => 1972
      'otdb-725079512abb', // In the 1979 British film "Quadrophenia" what is the name of the seaside city the mods a...
      'otdb-082e816448cd', // Who wrote the novel 'Fear And Loathing In Las Vegas'? => Hunter S. Thompson
      'otdb-6c7121e9236b', // Who had a 1976 hit with the song 'You Make Me Feel Like Dancing'? => Leo Sayer
      'otdb-6b524f33b042', // The 'In the Flesh' tour was used in support of what Pink Floyd album? => Animals
      'otdb-264c8cc322dd', // What Led Zeppelin album contains "Stairway to Heaven"? => Led Zeppelin IV
      'otdb-d859e34d6b81', // In what year was the last natural case of smallpox documented? => 1977
      'otdb-fb6cefe7dd4c', // Which company was established on April 1st, 1976 by Steve Jobs, Steve Wozniak and Ronal...
      'otdb-cae449c9af24', // In the 1976 film 'Taxi Driver', how many guns did Travis buy from the salesman? => 4
      'otdb-7ebf96f29c7b', // In order to cut costs, what were most of the extras of Mad Max (1979) paid with? => Beer
      'otdb-83ef3137274d', // The movie "The Rocky Horror Picture Show" (1975) opens with giant floating lips singing...
      'otdb-daa22593d5b6', // What is the correct phrase for the Latin saying "Romanes Eunt Domus" in Monty Python's ...
    ],
  },
  {
    slug: 'the-80s',
    title: 'The 80s',
    theme: 'culture-generale',
    description: 'Films, games, music and sport from the 1980s.',
    questions: [
      'otdb-55ea15c94a79', // Who starred as Bruce Wayne and Batman in Tim Burton's 1989 movie "Batman"? => Michael K...
      'otdb-7b2d7af370c7', // Which of these is not one of Dracula's relics found in the video game "Castlevania II: ...
      'otdb-9e9575dbaa06', // Which company did the animation for Peter Gabriel's Video Sledgehammer (1986)? => Aardm...
      'otdb-6b0457c3fa4f', // In the movie "Spaceballs", what are the Spaceballs attempting to steal from Planet Drui...
      'otdb-a6fbb06b1612', // Who directed "E.T. the Extra-Terrestrial" (1982)? => Steven Spielberg
      'otdb-c9c9a363bbfd', // In what year did the North American Video Game Crash occur? => 1983
      'otdb-5f3aef6e11c6', // Who is the main protagonist in, the 1985 film, Back to the Future? => Marty McFly
      'otdb-0a1b5569601d', // Who did the score to the original Blade Runner? => Vangelis
      'otdb-e7712a23ce87', // Blinky, Pinky, Inky and Clyde are characters from which classic video game? => Pac-Man
      'otdb-47f852b32b4a', // Who recorded the album called "Down to the Moon" in 1986? => Andreas Vollenweider
      'otdb-d7ca02b8e7a7', // With which doubles partner did John McEnroe have most success? => Peter Fleming
      'otdb-c9edc97b7bd8', // This movie contains the quote, "Nobody puts Baby in a corner." => Dirty Dancing
      'otdb-a6a86237d176', // Which Formula One driver was nicknamed 'The Professor'? => Alain Prost
      'otdb-d50785021ee7', // The IBM PC used an Intel 8008 microprocessor clocked at 4.77 MHz and 8 kilobytes of mem...
      'otdb-2ab6c55e5477', // Which of these are NOT a Men at Work song? => Basket Case
      'otdb-7f2b15d123a3', // America's Strategic Defense System during the Cold War was nicknamed after this famous ...
      'otdb-9043f57f959b', // The 1988 Formula 1 season had McLaren win all but one race, what race did they not win?...
    ],
  },
  {
    slug: 'the-90s',
    title: 'The 90s',
    theme: 'culture-generale',
    description: 'Films, music, games and news from the 1990s.',
    questions: [
      'otdb-be60f8adde97', // Who is the lead singer of Pearl Jam? => Eddie Vedder
      'otdb-4e9c7a24028f', // In the original script of "The Matrix", the machines used humans as additional computin...
      'otdb-0c33419931d3', // In 1993, Prince changed his name to an unpronounceable symbol because he was unhappy wi...
      'otdb-e95168f0e52a', // Which stand-up comedian voiced the talking parrot "Iago" in Disney's 1992 adaptation of...
      'otdb-b5723058621e', // Which actor played the main character in the 1990 film "Edward Scissorhands"? => Johnny...
      'otdb-51d82f8ddafd', // What was Daft Punk's first studio album? => Homework
      'otdb-55b700aca9f5', // When was Google founded? => September 4, 1998
      'otdb-cb3427e10e80', // "Doctor Jones", "Turn Back Time" and "Barbie Girl" were UK number ones for which Euroda...
      'otdb-0f70818e0a07', // In which movie does Robin Williams' character have to disguise themselves into a woman?...
      'otdb-342e650a0c31', // What was Britney Spears' debut single? => ...Baby One More Time
      'otdb-62fba77d68d4', // Which actress danced the twist with John Travolta in 'Pulp Fiction'? => Uma Thurman
      'otdb-406be632d7c5', // In which year was Nelson Mandela released from prison => 1990
      'otdb-579588941b6f', // In Sonic the Hedgehog universe, Tails' real name is Miles Prower. => true
      'otdb-50c861205b6a', // In Spyro the Dragon, what is Spyro's dragonfly friend called? => Sparx
      'otdb-d8c4bd6dfb51', // The collapse of the Soviet Union took place in which year? => 1991
      'otdb-b2152bdb43cf', // Which player "kung-fu kicked" a Crystal Palace fan in January 1995? => Eric Cantona
      'otdb-d84a3d66e4d4', // What type of Pokémon is Charizard? => Fire/Flying
      'otdb-eb119c33312d', // Which member of the British pop group "The Spice Girls" was known as Ginger Spice? => G...
      'otdb-3649cb53ae5a', // The F1 season of 1994 is remembered for what tragic event? => Death of Ayrton Senna (Sa...
      'otdb-c6b537dc98a4', // What year did the James Cameron film "Titanic" come out in theaters? => 1997
    ],
  },
  {
    slug: 'the-90s-2',
    title: 'The 90s #2',
    theme: 'culture-generale',
    description: 'More films, music, games and news from the 1990s.',
    questions: [
      'otdb-196cb65435bb', // In Mulan (1998), who is the leader of the Huns? => Shan Yu
      'otdb-409d3c197d33', // Who played Deputy Marshal Samuel Gerard in the 1993 film "The Fugitive"? => Tommy Lee J...
      'otdb-dd8f1cda33e2', // In the movie “The Iron Giant,” this character is the protagonist. => Hogarth Hughes
      'otdb-410c224a0e1e', // What is the real name of rapper, The Notorious B.I.G? => Christopher Wallace
      'otdb-994dcdd1b321', // Who is frozen at the end of the movie "Goldeneye"? => Boris Grishenko
      'otdb-0774fc6fff7b', // Artis Leon Ivey Jr. is better known as which rap artist? => Coolio
      'otdb-279b44c104ad', // Stephen Chbosky wrote the book 'The Perks of Being A Wallflower'. => true
      'otdb-82d5560445f5', // When was the Valve Corporation founded? => August 24, 1996
      'otdb-906acd1642bc', // Which 90's comedy cult classic features cameos appearances from Meat Loaf, Alice Cooper...
      'otdb-1acbb7d874b4', // In which year did the Invasion of Kuwait by Iraq occur? => 1990
      'otdb-ba07af7295c5', // "The first rule is: you don't talk about it" is a reference to which movie? => Fight Club
      'otdb-47823dde3a68', // Who is the lead singer of the Smashing Pumpkins? => Billy Corgan
      'otdb-e348980379e9', // When did the British hand-over sovereignty of Hong Kong back to China? => 1997
      'otdb-4f6489da3a2a', // With which team did Michael Schumacher make his Formula One debut at the 1991 Belgian G...
      'otdb-a91bbd0fa473', // The song Scatman's World was released after Scatman (Ski-Ba-Bop-Ba-Dop-Bop). => true
      'otdb-06cb1f4d13f1', // Who won the "Champions League" in 1999? => Manchester United
      'otdb-c1a5b9c48f1d', // Final Fantasy VI was originally released outside Japan under what name? => Final Fantas...
      'otdb-9b258da8c009', // What are tiny Thwomps called in Super Mario World? => Thwimps
      'otdb-f778f9af905a', // Which one of these rappers is NOT a member of the rap group Wu-Tang Clan? => Dr.Dre
      'otdb-65fb1590968e', // Dave Grohl recorded the Foo Fighters' debut, "Foo Fighters," by himself. => true
    ],
  },
  {
    slug: 'the-2000s',
    title: 'The 2000s',
    theme: 'culture-generale',
    description: 'Films, games, music and sport from the 2000s.',
    questions: [
      'otdb-87fa5e4002cc', // What name did Tom Hanks give to his volleyball companion in the film `Cast Away`? => Wi...
      'otdb-7cbe050cd412', // Which Daft Punk album is the song "Harder, Better, Faster, Stronger" from? => Discovery
      'otdb-61cd94809b8e', // In the Lord of the Rings: The Two Towers, where are the party of orcs taking the hobbit...
      'otdb-8992bd6147fb', // What is the name of the character Nicolas Cage plays in the movie "National Treasure?" ...
      'otdb-9a034edb9924', // Who is revealed to be the villain at the end of the first live action Scooby Doo movie?...
      'otdb-41f4dfb20591', // In the game "The Sims", how many Simoleons does each family start with? => 20,000
      'otdb-1124ddcc9d2f', // Green Day's album 'American Idiot' is considered a "punk rock opera." => true
      'otdb-483b3ed79236', // What was the name of the image that features as the default background wallpaper for Wi...
      'otdb-555c2354cc82', // In Need For Speed Most Wanted (2005), what do you drive at the beginning of the career ...
      'otdb-a61f33b3ecbe', // In 2008, Usain Bolt set the world record for the 100 meters with one shoelace untied. =...
      'otdb-cf994fe859c4', // Which water-type Pokémon starter was introduced in the 4th generation of the series? =>...
      'otdb-5b19cee0ac10', // Which year did Jenson Button won his first ever Formula One World Drivers' Championship...
      'otdb-d04c9a991725', // Where does "Gasolina" rapper Daddy Yankee originate from? => Puerto Rico
      'otdb-44be3c326674', // What song includes the words "Numa Numa" which was subject to a Viral Video in 2004? =>...
      'otdb-c507d052effe', // DragonForce's 'Through the Fire and Flames' is widely considered to be the hardest song...
      'otdb-67f54a87afb5', // In which African country was the 2006 film 'Blood Diamond' mostly set in? => Sierra Leone
      'otdb-1e69970acf18', // When did the website "Facebook" launch? => 2004
      'otdb-916ad59df8f2', // In Finding Nemo, what was the name of Nemo's mom? => Coral
      'otdb-b34547a50b7c', // What year was the game Team Fortress 2 released? => 2007
      'otdb-afbdf6f07334', // Which nation hosted the FIFA World Cup in 2006? => Germany
    ],
  },
  {
    slug: 'the-2010s',
    title: 'The 2010s',
    theme: 'culture-generale',
    description: 'Sport, music, games and films from the 2010s.',
    questions: [
      'otdb-01d846ce5610', // Which soccer player is featured on the cover of EA Sport's FIFA 18? => Cristiano Ronaldo
      'otdb-5b7dd27c8663', // "Friday," the single by Rebecca Black, was released in February 10th, 2011. => true
      'otdb-200dd2abeda2', // In Big Hero 6, what were Baymax's motions modeled after? => Baby penguins
      'otdb-2c38e1fb3339', // What was the final score of the Germany vs. Brazil 2014 FIFA World Cup match? => 7 - 1
      'otdb-3377f3cc932d', // In Avengers: Infinity War, where was the Soul Stone located? => Vormir
      'otdb-b9ee7a555007', // Who won the 2015 Formula 1 World Championship? => Lewis Hamilton
      'otdb-acf39f60b7b9', // Which team won the 2015-16 English Premier League? => Leicester City
      'otdb-c370d266e29a', // What was Taylor Swift's 5th album called? => 1989
      'otdb-f4998a7d9f8d', // What is the orange and white bot's name in "Star Wars: The Force Awakens"? => BB-8
      'otdb-e40e26a5706d', // Arcade Fire's 'The Suburbs' won the Album of the Year award in the 2011 Grammys. => true
      'otdb-8abfed286a97', // What is the opening track on Lorde's Pure Heroine? => Tennis Court
      'otdb-b2121206577b', // Which country won the 2018 FIFA World Cup hosted in Russia? => France
      'otdb-39838a0aae8d', // What national team won the 2016 edition of UEFA European Championship? => Portugal
      'otdb-9df83564342e', // What was the name given to Android 4.3? => Jelly Bean
      'otdb-782dabd95012', // Who is the villain company in "Stardew Valley"? => Joja Co
      'otdb-a558a0b9675f', // Which artist released the 2012 single "Harlem Shake", which was used in numerous YouTub...
      'otdb-d9c5e03ae397', // In the film "John Wick" why does John Wick get out of retirement? => His puppy is kille...
      'otdb-b787a8cd14fa', // What is Grumpy Cat's real name? => Tardar Sauce
      'otdb-3ec6a9506bf4', // What is the name of the main character in "Life is Strange"? => Maxine Caulfield
      'otdb-e700e20a2042', // Amazon acquired Twitch in August 2014 for $970 million dollars. => true
    ],
  },
  {
    slug: 'the-2010s-2',
    title: 'The 2010s #2',
    theme: 'culture-generale',
    description: 'More sport, music, games and films from the 2010s.',
    questions: [
      'otdb-f0534ac3f64b', // What machine element is located in the center of fidget spinners? => Bearings
      'otdb-3a45dfced3e5', // In the 2012 film, "The Lorax", who is the antagonist? => Aloysius O'Hare
      'otdb-dfecaaefe540', // What album did Gorillaz release in 2017? => Humanz
      'otdb-725ce6f7bfa5', // Leonardo Di Caprio won his first Best Actor Oscar for his performance in which film? =>...
      'otdb-a1afa7f2770c', // Who won the 2016 Formula 1 World Driver's Championship? => Nico Rosberg
      'otdb-a4e668e23f2a', // Which soccer team won the Copa América 2015 Championship ? => Chile
      'otdb-0afdda8e4d96', // In "Overwatch", Coalescence is the name for the ultimate of which hero? => Moira
      'otdb-9a6e0a051bfb', // What was the wifi password given to Stephen Strange in Doctor Strange? => Shambala
      'otdb-b9a2a03f0d27', // Who is the lead singer of The Lumineers? => Wesley Schultz
      'otdb-9fdc2e1148ed', // Which country hosted the 2018 FIFA World Cup? => Russia
      'otdb-8e2cb701bbba', // Which of these was the name of a bug found in April 2014 in the publicly available Open...
      'otdb-d313e78be9e3', // The album reputation by Taylor Swift has 15 songs => true
      'otdb-ca8475c4225f', // The Paradox Interactive game "Stellaris" was released in 2016. => true
      'otdb-bd63aadc24fc', // Which rapper had an album that went double platinum with no features? => J. Cole
      'otdb-eac186e3f158', // In "Undertale", the main character of the game is Sans. => false
      'otdb-5b05a12ae810', // The film Mad Max: Fury Road features the Dies Irae from which composer's requiem? => Verdi
      'otdb-ca3337610100', // Which car manufacturer won the 2016 24 Hours of Le Mans? => Porsche
      'otdb-062e53ea5c98', // Which iconic Disneyland attraction was closed in 2017 to be remodeled as a "Guardians o...
      'otdb-3e0e689540be', // "The Potato Sack" was a collection of indie games released on Steam in 2011 as a promot...
      'otdb-c0fd6d3a093a', // Who won the UEFA Champions League in 2017? => Real Madrid C.F.
    ],
  },
]
