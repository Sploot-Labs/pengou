/** Garde le typage : un catalogue doit avoir les mêmes clés en anglais et en espagnol. */
export function defineCatalog<K extends string>(c: {
  en: Record<K, string>
  es: Record<K, string>
}): { en: Record<K, string>; es: Record<K, string> } {
  return c
}
