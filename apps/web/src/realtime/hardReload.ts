/** Navigation complète (isolée pour être mockable : jsdom n'implémente pas la navigation). */
export function hardReload(url: string): void {
  window.location.assign(url)
}
