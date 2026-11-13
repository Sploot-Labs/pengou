import type { ImportedQuestion } from '@splootlabs/db'

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
