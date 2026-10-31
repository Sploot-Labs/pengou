// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { QuestionImageField, parseImageUrl } from './QuestionImageField'

afterEach(cleanup)

function setup(props: Partial<Parameters<typeof QuestionImageField>[0]> = {}) {
  const onChange = vi.fn()
  const upload = vi.fn((_file: File) => Promise.resolve('/uploads/t/a.png'))
  render(
    <QuestionImageField media={null} mediaAlt={null} onChange={onChange} upload={upload} {...props} />,
  )
  return { onChange, upload }
}

const png = () => new File(['x'], 'a.png', { type: 'image/png' })

describe('parseImageUrl', () => {
  it('refuse http', () =>
    expect(parseImageUrl('http://exemple.org/a.png')).toEqual({
      ok: false,
      error: 'Seules les adresses https sont acceptées.',
    }))
  it('refuse une adresse invalide', () =>
    expect(parseImageUrl('pas une url')).toEqual({ ok: false, error: 'Adresse invalide.' }))
  it('accepte https et trime', () =>
    expect(parseImageUrl('  https://exemple.org/a.png ')).toEqual({
      ok: true,
      url: 'https://exemple.org/a.png',
    }))
})

describe('QuestionImageField', () => {
  it('URL http collée : message affiché, onChange jamais appelé', () => {
    const { onChange } = setup()
    const field = screen.getByLabelText("Ou coller l'adresse d'une image")
    fireEvent.change(field, { target: { value: 'http://exemple.org/a.png' } })
    fireEvent.click(screen.getByRole('button', { name: 'Utiliser' }))
    expect(screen.getByText('Seules les adresses https sont acceptées.')).toBeInTheDocument()
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('URL https collée : onChange({ media })', () => {
    const { onChange } = setup()
    fireEvent.change(screen.getByLabelText("Ou coller l'adresse d'une image"), {
      target: { value: 'https://exemple.org/a.png' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Utiliser' }))
    expect(onChange).toHaveBeenCalledWith({ media: 'https://exemple.org/a.png' })
  })

  it('envoi de fichier : appelle upload puis onChange({ media: url })', async () => {
    const { onChange, upload } = setup()
    const file = png()
    fireEvent.change(screen.getByTestId('question-image-file'), { target: { files: [file] } })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ media: '/uploads/t/a.png' }))
    expect(upload).toHaveBeenCalledWith(file)
  })

  it("pendant l'envoi, le bouton est désactivé et affiche Envoi…", async () => {
    let resolve!: (u: string) => void
    const upload = vi.fn(() => new Promise<string>((r) => (resolve = r)))
    setup({ upload })
    fireEvent.change(screen.getByTestId('question-image-file'), { target: { files: [png()] } })
    expect(await screen.findByRole('button', { name: 'Envoi…' })).toBeDisabled()
    resolve('/uploads/t/a.png')
    await screen.findByRole('button', { name: 'Envoyer une image' })
  })

  it('échec 413 de upload : affiche le message serveur, onChange jamais appelé', async () => {
    const upload = vi.fn(() => Promise.reject(new ApiError(413, 'Image trop lourde (2 Mo max).')))
    const { onChange } = setup({ upload })
    fireEvent.change(screen.getByTestId('question-image-file'), { target: { files: [png()] } })
    expect(await screen.findByText('Image trop lourde (2 Mo max).')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it("Retirer l'image : onChange({ media: null, mediaAlt: null })", () => {
    const { onChange } = setup({ media: '/uploads/t/a.png', mediaAlt: 'Un manchot' })
    fireEvent.click(screen.getByRole('button', { name: "Retirer l'image" }))
    expect(onChange).toHaveBeenCalledWith({ media: null, mediaAlt: null })
  })

  it("affiche l'aperçu avec le texte alternatif quand media est présent", () => {
    setup({ media: '/uploads/t/a.png', mediaAlt: 'Un manchot' })
    expect(screen.getByRole('img', { name: 'Un manchot' })).toHaveAttribute('src', '/uploads/t/a.png')
    const alt = screen.getByLabelText('Texte alternatif')
    expect(alt).toHaveValue('Un manchot')
    expect(alt).toHaveAttribute('maxlength', '200')
  })

  it('saisir le texte alternatif appelle onChange({ mediaAlt })', () => {
    const { onChange } = setup({ media: '/uploads/t/a.png', mediaAlt: null })
    fireEvent.change(screen.getByLabelText('Texte alternatif'), { target: { value: 'Un manchot' } })
    expect(onChange).toHaveBeenCalledWith({ mediaAlt: 'Un manchot' })
  })
})
