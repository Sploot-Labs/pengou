import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist' },
  server: {
    // Vite bloque par défaut toute requête dont le Host n'est pas localhost
    // (« This host is not allowed »). Pour exposer le dev server via un tunnel
    // (ngrok) le temps d'un test, on autorise UNIQUEMENT les domaines ngrok
    // (wildcards à point initial) — pas « n'importe quel host ».
    allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.io', '.ngrok.dev'],
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
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
        changeOrigin: false,
        // Même raison que /api : le CORS Socket.IO (resserré au lot hardening)
        // n'autorise que l'origine de baseURL (+ localhost en dev). Sans cette
        // réécriture, un accès via tunnel (ngrok) présenterait l'Origin du
        // tunnel → handshake rejeté. On réécrit vers baseURL à la fois sur la
        // requête HTTP (handshake polling) ET sur l'upgrade WebSocket.
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('origin', 'http://localhost:3000')
          })
          proxy.on('proxyReqWs', (proxyReq) => {
            proxyReq.setHeader('origin', 'http://localhost:3000')
          })
        },
      },
    },
  },
})
