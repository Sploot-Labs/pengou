// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionReport as SessionReportData, SessionReportQuestion } from '../api/sessions'

vi.mock('../api/sessions', () => ({
  getSessionReport: vi.fn(),
  sessionCsvUrl: (id: string) => `/api/sessions/${id}/export.csv`,
}))

import * as sessions from '../api/sessions'
import { SessionReport } from './SessionReport'

function question(over: Partial<SessionReportQuestion>): SessionReportQuestion {
  return {
    questionId: 'q',
    prompt: 'Question',
    type: 'mcq',
    orderIndex: 0,
    answerCount: 0,
    correctCount: null,
    avgTimeMs: null,
    wordcloud: null,
    poll: null,
    ...over,
  }
}

function report(questions: SessionReportQuestion[]): SessionReportData {
  return {
    session: {
      id: 's1',
      pin: '123456',
      status: 'ended',
      startedAt: null,
      endedAt: null,
      quizId: 'z',
      quizTitle: 'Mon quiz',
    },
    questions,
    players: [],
  }
}

async function renderReport(questions: SessionReportQuestion[]) {
  vi.mocked(sessions.getSessionReport).mockResolvedValue(report(questions))
  render(
    <MemoryRouter initialEntries={['/sessions/s1']}>
      <Routes>
        <Route path="/sessions/:sessionId" element={<SessionReport />} />
      </Routes>
    </MemoryRouter>,
  )
  await screen.findByText('Mon quiz')
}

function rowOf(prompt: string): HTMLElement {
  return screen.getByText(prompt).closest('tr') as HTMLElement
}

afterEach(cleanup)

describe('SessionReport, questions nuage de mots', () => {
  it("affiche les quatre premières idées dans l'ordre reçu", async () => {
    const words = ['café', 'thé', 'eau', 'jus', 'lait', 'soda'].map((text, i) => ({ text, count: 6 - i }))
    await renderReport([
      question({
        questionId: 'w',
        prompt: 'Vos idées ?',
        type: 'wordcloud',
        answerCount: 5,
        wordcloud: { participants: 5, totalWords: 21, words },
      }),
    ])
    const row = within(rowOf('Vos idées ?'))
    expect(row.getByText(/Nuage de mots, 5 participants, 21 mots : /)).toBeTruthy()
    expect(row.getByText(/café \(6\), thé \(5\), eau \(4\), jus \(3\)/)).toBeTruthy()
    expect(row.queryByText(/lait/)).toBeNull()
    expect(row.queryByText(/aucune réponse/)).toBeNull()
  })

  it('affiche « Aucune idée proposée » pour un nuage vide', async () => {
    await renderReport([
      question({
        prompt: 'Vide ?',
        type: 'wordcloud',
        wordcloud: { participants: 0, totalWords: 0, words: [] },
      }),
    ])
    expect(within(rowOf('Vide ?')).getByText('Nuage de mots, 0 participant, 0 mot. Aucune idée proposée')).toBeTruthy()
  })

  it('garde le taux des autres questions et ignore le nuage pour la plus ratée', async () => {
    await renderReport([
      question({ questionId: 'a', prompt: 'QCM', answerCount: 4, correctCount: 2, avgTimeMs: 2000 }),
      question({
        questionId: 'w',
        prompt: 'Nuage',
        type: 'wordcloud',
        orderIndex: 1,
        wordcloud: { participants: 1, totalWords: 1, words: [{ text: 'a', count: 1 }] },
      }),
    ])
    expect(within(rowOf('Nuage')).getByText('Nuage de mots, 1 participant, 1 mot : a (1)')).toBeTruthy()
    expect(within(rowOf('QCM')).getByText('50 % (2/4)')).toBeTruthy()
    expect(within(rowOf('QCM')).getByText('Question la plus ratée')).toBeTruthy()
    expect(within(rowOf('Nuage')).queryByText('Question la plus ratée')).toBeNull()
  })
})

describe('SessionReport, questions sondage', () => {
  const poll = (voters: number, votes: number[]) => ({
    voters,
    multiple: false,
    options: votes.map((v, i) => ({ label: ['Oui', 'Non', 'Peut-être'][i] as string, votes: v })),
  })

  it('affiche chaque choix avec ses votes et son pourcentage', async () => {
    await renderReport([question({ prompt: 'Sondé ?', type: 'poll', answerCount: 3, poll: poll(3, [2, 1, 0]) })])
    const row = within(rowOf('Sondé ?'))
    expect(row.getByText('Sondage, 3 participants')).toBeTruthy()
    expect(row.getByText(/Oui : 2 votes \(67 %\)/)).toBeTruthy()
    expect(row.getByText(/Non : 1 vote \(33 %\)/)).toBeTruthy()
    expect(row.getByText(/Peut-être : 0 vote \(0 %\)/)).toBeTruthy()
    expect(row.getByText(/Oui : 2 votes/).textContent).toBe('Oui : 2 votes (67 %)')
    expect(row.queryByText(/aucune réponse/)).toBeNull()
  })

  it('affiche « Aucun vote » sans votant', async () => {
    await renderReport([question({ prompt: 'Vide ?', type: 'poll', poll: poll(0, [0, 0]) })])
    const row = within(rowOf('Vide ?'))
    expect(row.getByText('Sondage, 0 participant')).toBeTruthy()
    expect(row.getByText('Aucun vote')).toBeTruthy()
    expect(row.queryByText(/NaN/)).toBeNull()
  })

  it('ne marque jamais le sondage comme question la plus ratée', async () => {
    await renderReport([
      question({ questionId: 'a', prompt: 'QCM', answerCount: 4, correctCount: 2, avgTimeMs: 2000 }),
      question({
        questionId: 'p',
        prompt: 'Sondage',
        type: 'poll',
        orderIndex: 1,
        answerCount: 2,
        poll: poll(2, [1, 1]),
      }),
    ])
    expect(within(rowOf('QCM')).getByText('Question la plus ratée')).toBeTruthy()
    expect(within(rowOf('Sondage')).queryByText('Question la plus ratée')).toBeNull()
  })
})
