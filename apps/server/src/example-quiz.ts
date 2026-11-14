import type { ImportedQuestion } from '@splootlabs/db'
import type { Lang } from '@splootlabs/shared/i18n'

/**
 * Quiz d'exemple offert juste après l'inscription : cinq questions courtes, une par grand type
 * (QCM, vrai ou faux, curseur, sondage, nuage de mots), que l'hôte modifie pour faire le sien.
 * Contenu original de Pengou, sans source externe à créditer.
 */
export const EXAMPLE_QUIZ = {
  title: 'Mon premier quiz (exemple)',
  description: "Un quiz d'exemple à modifier : changez les questions, ajoutez les vôtres, puis lancez la partie.",
  questions: [
    {
      type: 'mcq',
      prompt: "Quelle est la capitale de l'Australie ?",
      payload: {
        options: [
          { label: 'Sydney', correct: false },
          { label: 'Canberra', correct: true },
          { label: 'Melbourne', correct: false },
          { label: 'Perth', correct: false },
        ],
      },
      timeLimit: 20,
      readingTime: 6,
      source: null,
    },
    {
      type: 'truefalse',
      prompt: 'Le manchot empereur est le plus grand des manchots.',
      payload: { correct: true },
      timeLimit: 15,
      readingTime: 6,
      source: null,
    },
    {
      type: 'slider',
      prompt: 'En quelle année a eu lieu le premier pas sur la Lune ?',
      payload: { min: 1950, max: 2000, correct: 1969, step: 1 },
      timeLimit: 20,
      readingTime: 6,
      source: null,
    },
    {
      type: 'poll',
      prompt: 'Quel thème préférez-vous pour la prochaine partie ?',
      payload: {
        options: [{ label: 'Sciences' }, { label: 'Histoire' }, { label: 'Cinéma' }, { label: 'Sport' }],
        multiple: false,
      },
      timeLimit: 20,
      readingTime: 0,
      source: null,
    },
    {
      type: 'wordcloud',
      prompt: 'En un mot, comment avez-vous trouvé ce quiz ?',
      payload: {},
      timeLimit: 30,
      readingTime: 0,
      source: null,
    },
  ] satisfies ImportedQuestion[],
}

type ExampleText = {
  title: string
  description: string
  prompts: [string, string, string, string, string]
  mcq: [string, string, string, string]
  poll: [string, string, string, string]
}

/** Textes traduits ; réglages, types et bonnes réponses restent ceux de `EXAMPLE_QUIZ`. */
const TRANSLATIONS: Record<'en' | 'es', ExampleText> = {
  en: {
    title: 'My first quiz (example)',
    description: 'An example quiz to edit: change the questions, add your own, then start the game.',
    prompts: [
      'What is the capital of Australia?',
      'The emperor penguin is the largest of all penguins.',
      'In what year did humans first set foot on the Moon?',
      'Which theme do you prefer for the next game?',
      'In one word, what did you think of this quiz?',
    ],
    mcq: ['Sydney', 'Canberra', 'Melbourne', 'Perth'],
    poll: ['Science', 'History', 'Movies', 'Sports'],
  },
  es: {
    title: 'Mi primer quiz (ejemplo)',
    description: 'Un quiz de ejemplo para modificar: cambia las preguntas, añade las tuyas y empieza la partida.',
    prompts: [
      '¿Cuál es la capital de Australia?',
      'El pingüino emperador es el más grande de los pingüinos.',
      '¿En qué año pisó el ser humano la Luna por primera vez?',
      '¿Qué tema prefieres para la próxima partida?',
      'En una palabra, ¿qué te ha parecido este quiz?',
    ],
    mcq: ['Sídney', 'Canberra', 'Melbourne', 'Perth'],
    poll: ['Ciencias', 'Historia', 'Cine', 'Deporte'],
  },
}

function translated(text: ExampleText): typeof EXAMPLE_QUIZ {
  const quiz = structuredClone(EXAMPLE_QUIZ)
  quiz.title = text.title
  quiz.description = text.description
  quiz.questions.forEach((q, i) => {
    q.prompt = text.prompts[i] as string
  })
  const [mcq, , , poll] = quiz.questions
  ;(mcq.payload as { options: { label: string }[] }).options.forEach((o, i) => {
    o.label = text.mcq[i] as string
  })
  ;(poll.payload as { options: { label: string }[] }).options.forEach((o, i) => {
    o.label = text.poll[i] as string
  })
  return quiz
}

const BY_LANG: Record<Lang, typeof EXAMPLE_QUIZ> = {
  fr: EXAMPLE_QUIZ,
  en: translated(TRANSLATIONS.en),
  es: translated(TRANSLATIONS.es),
}

/** Quiz d'exemple dans la langue demandée (le français est `EXAMPLE_QUIZ`). */
export function exampleQuiz(lang: Lang): typeof EXAMPLE_QUIZ {
  return BY_LANG[lang]
}
