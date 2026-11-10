import { apiPostForm } from './client'

/** Envoie une image sur `POST /api/media` (tenant porté par l'en-tête x-tenant-id). */
export function uploadMedia(file: Blob, filename: string): Promise<{ url: string }> {
  const form = new FormData()
  form.append('file', file, filename)
  return apiPostForm<{ url: string }>('/api/media', form)
}
