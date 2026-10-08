/**
 * Small static fixtures shared across screens — NOT quiz/answer data.
 *
 * The 4 answer shapes (triangle/diamond/circle/square) are a fixed design
 * convention of the Pingou UI (shape + colour reinforcing the same 4 answer
 * slots everywhere: editor, player tiles, big screen, reveal). This lives
 * here — not in a "mock" file — because it's real UI vocabulary, not sample
 * data standing in for the backend.
 */

export type AnswerShapeKind = 'triangle' | 'diamond' | 'circle' | 'square'

/** The 4 shapes in the fixed order used to assign them to mcq options. */
export const ANSWER_SHAPES: AnswerShapeKind[] = ['triangle', 'diamond', 'circle', 'square']
