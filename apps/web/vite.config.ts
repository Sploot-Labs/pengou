import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist' },
  server: {
    proxy: {
      // changeOrigin: false — l'Origin envoyé au serveur reste celui du
      // navigateur (localhost:5173), requis par la vérification CSRF de
      // Better Auth. En prod le même processus Fastify sert le SPA, donc
      // ce proxy ne concerne que le dev.
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
      '/socket.io': { target: 'http://localhost:3000', ws: true, changeOrigin: false },
    },
  },
})
