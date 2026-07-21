import { Server } from 'socket.io'
import type { FastifyInstance } from 'fastify'

export function attachRealtime(app: FastifyInstance): Server {
  const io = new Server(app.server, { cors: { origin: true } })

  io.on('connection', (socket) => {
    socket.on('ping:test', (ack?: (msg: string) => void) => {
      if (typeof ack === 'function') ack('pong')
    })
  })

  return io
}
