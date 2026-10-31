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
export const EXCLUDED: Record<string, string> = {}

// Thème d'une question (identifiant vers thème), prioritaire sur celui de sa catégorie.
export const QUESTION_THEME: Record<string, string> = {}

// Questions isolées pour adultes, en plus des quiz source de `ADULT_QUIZZES`.
export const ADULT_QUESTIONS: string[] = []
