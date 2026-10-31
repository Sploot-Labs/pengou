// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUploadMedia, mockPrepare } = vi.hoisted(() => ({
  mockUploadMedia: vi.fn(),
  mockPrepare: vi.fn(),
}))

vi.mock('../api/media', () => ({ uploadMedia: mockUploadMedia }))
vi.mock('../media/downscale', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../media/downscale')>()),
  prepareImageForUpload: mockPrepare,
}))

import { QuestionImageField } from './QuestionImageField'

const TWO_MIB = 2 * 1024 * 1024

function pick(onChange = vi.fn()) {
  render(<QuestionImageField media={null} mediaAlt={null} onChange={onChange} />)
  fireEvent.change(screen.getByTestId('question-image-file'), {
    target: { files: [new File(['x'], 'photo.png', { type: 'image/png' })] },
  })
  return onChange
}

describe('QuestionImageField, envoi par défaut', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUploadMedia.mockResolvedValue({ url: '/uploads/t/a.jpg' })
  })
  afterEach(cleanup)

  it('un blob réduit de 2 Mo + 1 octet : aucun appel réseau et message « même après réduction »', async () => {
    mockPrepare.mockResolvedValue({
      blob: new Blob([new Uint8Array(TWO_MIB + 1)], { type: 'image/jpeg' }),
      transformed: true,
    })
    const onChange = pick()
    expect(
      await screen.findByText('Image trop lourde, même après réduction (2 Mo max).'),
    ).toBeInTheDocument()
    expect(mockUploadMedia).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('un fichier non réduit (GIF) de 2 Mo + 1 octet : message de taille sans mention de réduction', async () => {
    mockPrepare.mockResolvedValue({
      blob: new Blob([new Uint8Array(TWO_MIB + 1)], { type: 'image/gif' }),
      transformed: false,
    })
    const onChange = pick()
    expect(await screen.findByText('Image trop lourde (2 Mo max).')).toBeInTheDocument()
    expect(screen.queryByText(/même après réduction/)).not.toBeInTheDocument()
    expect(mockUploadMedia).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it.each([
    ['image/jpeg', 'image.jpg'],
    ['image/webp', 'image.webp'],
    ['image/png', 'image.png'],
  ])('un blob %s est envoyé sous le nom %s', async (type, filename) => {
    const blob = new Blob(['x'], { type })
    mockPrepare.mockResolvedValue({ blob, transformed: true })
    const onChange = pick()
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ media: '/uploads/t/a.jpg' }))
    expect(mockUploadMedia).toHaveBeenCalledWith(blob, filename)
  })
})
