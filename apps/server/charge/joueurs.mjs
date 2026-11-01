// Processus enfant du générateur de charge : ouvre une socket par joueur, rejoint la partie à
// l'instant prévu, répond à chaque question et mesure ce qu'il voit côté client.
// Protocole IPC (voir charge.mjs) : reçoit `demarrer` puis `terminer`, envoie `arrivees` puis `resultat`.
import { performance, monitorEventLoopDelay } from 'node:perf_hooks'
import { io } from 'socket.io-client'

const ACK_MAX_MS = 10_000

const joinMs = []
const reponseMs = []
const acceptesParPin = {}
const rejointsParPin = {}
const refus = {}
const receptions = []
const erreurs = { ackTimeout: 0, reponseRefusee: 0, connexion: 0 }
let deconnexions = 0
let termine = false

const sockets = []
const minuteurs = new Set()
const lag = monitorEventLoopDelay({ resolution: 10 })

const incrementer = (compteur, cle) => {
  compteur[cle] = (compteur[cle] ?? 0) + 1
}

const planifier = (fn, delaiMs) => {
  const t = setTimeout(() => {
    minuteurs.delete(t)
    fn()
  }, Math.max(0, delaiMs))
  minuteurs.add(t)
}

const tirer = ([min, max]) => min + Math.random() * (max - min)

/** Connecte un joueur, tente le `player:join` et appelle `fini` une seule fois, quelle que soit l'issue. */
function lancerJoueur({ pin, pseudo }, cible, plageReponseMs, fini) {
  let regle = false
  const regler = () => {
    if (regle) return
    regle = true
    fini()
  }
  const socket = io(cible, { transports: ['websocket'], reconnection: false, forceNew: true })
  sockets.push(socket)
  const indexRepondus = new Set()

  socket.on('connect_error', () => {
    erreurs.connexion += 1
    regler()
  })
  socket.on('disconnect', () => {
    if (!termine) deconnexions += 1
    regler()
  })
  socket.on('question:show', (vue) => {
    const index = vue?.index
    receptions.push({ pin, index, epochMs: Date.now() })
    if (indexRepondus.has(index)) return
    indexRepondus.add(index)
    planifier(() => {
      if (termine) return
      const debut = performance.now()
      socket.timeout(ACK_MAX_MS).emit('player:answer', { answer: { optionIndex: Math.floor(Math.random() * 4) } }, (err, ack) => {
        if (err) {
          erreurs.ackTimeout += 1
          return
        }
        if (!ack?.accepted) {
          erreurs.reponseRefusee += 1
          return
        }
        reponseMs.push(performance.now() - debut)
        incrementer(acceptesParPin, pin)
      })
    }, tirer(plageReponseMs))
  })
  socket.once('connect', () => {
    const debut = performance.now()
    socket.timeout(ACK_MAX_MS).emit('player:join', { pin, nickname: pseudo }, (err, ack) => {
      if (err) erreurs.ackTimeout += 1
      else if (ack?.error) incrementer(refus, ack.error)
      else {
        joinMs.push(performance.now() - debut)
        incrementer(rejointsParPin, pin)
      }
      regler()
    })
  })
}

function demarrer({ cible, debutEpochMs, joueurs, reponseMs: plageReponseMs }) {
  lag.enable()
  let restants = joueurs.length
  const unDeMoins = () => {
    restants -= 1
    if (restants === 0) process.send({ type: 'arrivees', rejointsParPin, refus })
  }
  if (restants === 0) {
    process.send({ type: 'arrivees', rejointsParPin, refus })
    return
  }
  for (const joueur of joueurs) {
    planifier(() => lancerJoueur(joueur, cible, plageReponseMs, unDeMoins), debutEpochMs + joueur.decalageMs - Date.now())
  }
}

function terminer() {
  termine = true
  for (const t of minuteurs) clearTimeout(t)
  minuteurs.clear()
  for (const s of sockets) s.close()
  lag.disable()
  const lagP99Ms = lag.count > 0 ? lag.percentile(99) / 1e6 : 0
  process.send(
    { type: 'resultat', joinMs, reponseMs, acceptesParPin, receptions, erreurs, deconnexions, lagP99Ms },
    () => process.exit(0),
  )
}

process.on('message', (msg) => {
  if (msg?.type === 'demarrer') demarrer(msg)
  else if (msg?.type === 'terminer') terminer()
})
// Parent disparu : rien à mesurer de plus, on s'arrête.
process.on('disconnect', () => {
  if (!termine) process.exit(1)
})
