import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist' },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        // changeOrigin ne réécrit QUE le header Host, jamais Origin (vérifié
        // à la main : avec changeOrigin:false, le navigateur envoie tel quel
        // son origine réelle, ex. http://localhost:5173/5174/5175 selon le
        // port pris par Vite). Or Better Auth valide l'Origin de chaque
        // requête d'état contre `trustedOrigins`, qui ne contient par défaut
        // QUE l'origine de `baseURL` (http://localhost:3000 côté serveur) —
        // toute autre Origin est rejetée en 403 `Invalid origin`, PIN/mot de
        // passe corrects ou non. Palliatif ci-dessous : on réécrit l'Origin
        // sortante vers celle de baseURL, pour que le back voie exactement
        // ce qu'il verra en prod (même processus, donc même origine réelle).
        changeOrigin: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('origin', 'http://localhost:3000')
          })
        },
      },
      '/socket.io': { target: 'http://localhost:3000', ws: true, changeOrigin: false },
    },
  },
})
