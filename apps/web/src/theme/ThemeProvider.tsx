import { createContext, useContext, type ReactNode } from 'react'
import './tokens.motion.css'
import './themes.css'

export type ProductTheme = 'app' | 'scene'
export type ColorScheme = 'light' | 'dark'

interface ThemeContextValue {
  theme: ProductTheme
}

const ThemeContext = createContext<ThemeContextValue>({ theme: 'app' })

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}

/**
 * Applique le thème PRODUIT (data-theme) et, optionnellement, un schéma de
 * couleur forcé (data-scheme) sur un wrapper local — pas sur <html> — pour que
 * plusieurs thèmes puissent coexister par sous-arbre de route (ex. le grand
 * écran en `scene`/`dark` pendant que le reste est en `app`).
 */
export function ThemeProvider({
  theme,
  scheme,
  children,
}: {
  theme: ProductTheme
  scheme?: ColorScheme
  children: ReactNode
}) {
  return (
    <ThemeContext.Provider value={{ theme }}>
      <div data-theme={theme} {...(scheme ? { 'data-scheme': scheme } : {})}>
        {children}
      </div>
    </ThemeContext.Provider>
  )
}
