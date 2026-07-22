/**
 * Mock data for the Arena Broadcast UI prototype.
 * No network calls — every screen reads from these fixtures and mutates
 * local React state only.
 */

export type AnswerShapeKind = 'triangle' | 'diamond' | 'circle' | 'square'

export interface AnswerOption {
  id: string
  shape: AnswerShapeKind
  label: string
  correct: boolean
}

export type QuestionType = 'mcq' | 'truefalse' | 'text' | 'slider'

interface QuestionBase {
  id: string
  type: QuestionType
  prompt: string
  durationSeconds: number
  points: number
}

export interface McqQuestion extends QuestionBase {
  type: 'mcq'
  options: AnswerOption[] // exactly 4
}

export interface TrueFalseQuestion extends QuestionBase {
  type: 'truefalse'
  correctAnswer: boolean
}

export interface TextQuestion extends QuestionBase {
  type: 'text'
  acceptedAnswers: string[]
}

export interface SliderQuestion extends QuestionBase {
  type: 'slider'
  min: number
  max: number
  step: number
  correctValue: number
}

export type Question = McqQuestion | TrueFalseQuestion | TextQuestion | SliderQuestion

export interface Quiz {
  id: string
  title: string
  description: string
  questions: Question[]
}

export const mockQuiz: Quiz = {
  id: 'quiz-1',
  title: 'Culture générale — spécial vendredi',
  description: 'Cinq questions pour réveiller la salle avant le week-end.',
  questions: [
    {
      id: 'q1',
      type: 'mcq',
      prompt: 'Quelle planète est surnommée la « planète rouge » ?',
      durationSeconds: 20,
      points: 1000,
      options: [
        { id: 'q1-a', shape: 'triangle', label: 'Vénus', correct: false },
        { id: 'q1-b', shape: 'diamond', label: 'Mars', correct: true },
        { id: 'q1-c', shape: 'circle', label: 'Jupiter', correct: false },
        { id: 'q1-d', shape: 'square', label: 'Saturne', correct: false },
      ],
    },
    {
      id: 'q2',
      type: 'truefalse',
      prompt: 'Le Mont Blanc est le plus haut sommet d’Europe occidentale.',
      durationSeconds: 10,
      points: 500,
      correctAnswer: true,
    },
    {
      id: 'q3',
      type: 'mcq',
      prompt: 'Quel est le plus grand océan du monde ?',
      durationSeconds: 20,
      points: 1000,
      options: [
        { id: 'q3-a', shape: 'triangle', label: 'Atlantique', correct: false },
        { id: 'q3-b', shape: 'diamond', label: 'Indien', correct: false },
        { id: 'q3-c', shape: 'circle', label: 'Pacifique', correct: true },
        { id: 'q3-d', shape: 'square', label: 'Arctique', correct: false },
      ],
    },
    {
      id: 'q4',
      type: 'text',
      prompt: 'Quelle est la capitale de l’Islande ?',
      durationSeconds: 25,
      points: 1500,
      acceptedAnswers: ['reykjavik', 'reykjavík'],
    },
    {
      id: 'q5',
      type: 'slider',
      prompt: 'En quelle année a eu lieu la première Coupe du monde de football ?',
      durationSeconds: 20,
      points: 1200,
      min: 1900,
      max: 2000,
      step: 1,
      correctValue: 1930,
    },
  ],
}

export interface Player {
  id: string
  pseudo: string
  score: number
}

export const mockPlayers: Player[] = [
  { id: 'p1', pseudo: 'FoxtrotNova', score: 8200 },
  { id: 'p2', pseudo: 'PixelDauphin', score: 7650 },
  { id: 'p3', pseudo: 'QuartzLoutre', score: 7200 },
  { id: 'p4', pseudo: 'MangueViolette', score: 6100 },
  { id: 'p5', pseudo: 'CactusEnJean', score: 5400 },
  { id: 'p6', pseudo: 'ZebreDeMinuit', score: 4300 },
]

/**
 * The local player ("Vous"). Included in the single session dataset so that
 * lobby → live → provisional ranking → podium all describe the same game.
 * Its score is a plausible default used by BigScreen/Podium; PlayerLive
 * overrides it with the live score accumulated on the device.
 */
export const youPlayer: Player = { id: 'you', pseudo: 'Vous', score: 6800 }

/** Coherent per-session player set shared by every screen (includes « Vous »). */
export const sessionPlayers: Player[] = [...mockPlayers, youPlayer]

/** Ranking sorted by score descending, with rank attached. */
export function getRanking(players: Player[] = sessionPlayers): (Player & { rank: number })[] {
  return [...players]
    .sort((a, b) => b.score - a.score)
    .map((player, index) => ({ ...player, rank: index + 1 }))
}

/** Mock distribution of answers for the current live question (BigScreen). */
export interface AnswerDistributionEntry {
  optionId: string
  count: number
}

export const mockLiveQuestionState = {
  questionIndex: 0,
  remainingSeconds: 12,
  totalSeconds: 20,
  answersReceived: 4,
  totalPlayers: mockPlayers.length,
  distribution: [
    { optionId: 'q1-a', count: 1 },
    { optionId: 'q1-b', count: 4 },
    { optionId: 'q1-c', count: 0 },
    { optionId: 'q1-d', count: 1 },
  ] satisfies AnswerDistributionEntry[],
}

export const mockGamePin = '482913'
