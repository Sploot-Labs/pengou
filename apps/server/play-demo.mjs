// Démo : joue une VRAIE partie contre le serveur en cours d'exécution.
// Hôte (authentifié) + 3 joueurs, via les vrais événements Socket.IO.
import { io } from 'socket.io-client'

const BASE = 'http://localhost:3000'
const log = (...a) => console.log(...a)
const hr = (t) => log('\n' + '─'.repeat(64) + '\n  ' + t + '\n' + '─'.repeat(64))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// emit avec ack, promisifié — ÉCHOUE si le serveur renvoie une erreur
const ask = (sock, ev, payload) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${ev}`)), 8000)
    sock.emit(ev, payload, (ack) => {
      clearTimeout(t)
      if (ack && ack.error) return reject(new Error(`${ev} → ${ack.error}`))
      resolve(ack)
    })
  })
const once = (sock, ev) =>
  new Promise((resolve) => sock.once(ev, resolve))

// fetch qui échoue bruyamment
async function api(path, init) {
  // Better Auth applique une protection CSRF : l'Origin doit correspondre au baseURL.
  const headers = { origin: BASE, ...(init?.headers ?? {}) }
  const res = await fetch(`${BASE}${path}`, { ...init, headers })
  const text = await res.text()
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status} ${text}`)
  return { res, json: text ? JSON.parse(text) : null }
}

async function main() {
  hr('1. Inscription de l’hôte + création du quiz (API REST)')
  const email = `hote-${Date.now()}@arena.fr`
  const { res: signUp } = await api('/api/auth/sign-up/email', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'motdepasse-demo-123', name: 'Hôte Démo' }),
  })
  const rawCookies = signUp.headers.getSetCookie
    ? signUp.headers.getSetCookie()
    : [signUp.headers.get('set-cookie')]
  const cookie = rawCookies.filter(Boolean).map((c) => c.split(';')[0]).join('; ')
  if (!cookie) throw new Error('aucun cookie de session reçu à l’inscription')
  log(`   ✔ hôte inscrit : ${email}`)

  const H = { 'content-type': 'application/json', cookie }
  const { json: quiz } = await api('/api/quizzes', {
    method: 'POST', headers: H, body: JSON.stringify({ title: 'Culture générale — démo' }),
  })
  log(`   ✔ quiz créé : « ${quiz.title} »`)

  const mkQ = (body) => api(`/api/quizzes/${quiz.id}/questions`, {
    method: 'POST', headers: H, body: JSON.stringify(body),
  }).then((r) => r.json)

  await mkQ({
    type: 'mcq', prompt: 'Quelle planète est surnommée la « planète rouge » ?', timeLimit: 20,
    payload: { options: [
      { label: 'Vénus', correct: false }, { label: 'Mars', correct: true },
      { label: 'Jupiter', correct: false }, { label: 'Saturne', correct: false },
    ] },
  })
  await mkQ({
    type: 'truefalse', prompt: 'Le Mont Blanc est le plus haut sommet d’Europe occidentale.',
    timeLimit: 15, payload: { correct: true },
  })
  log('   ✔ 2 questions ajoutées (QCM + Vrai/Faux)')

  hr('2. L’hôte ouvre une session — un code PIN est généré')
  const host = io(BASE, { extraHeaders: { cookie }, transports: ['websocket'] })
  await once(host, 'connect')
  const created = await ask(host, 'host:create', { quizId: quiz.id })
  const { sessionId, pin } = created
  log(`   🎯 PIN de la partie : ${pin}`)

  hr('3. Trois joueurs rejoignent avec le PIN')
  const names = ['RenardAgile', 'PixelDauphin', 'QuartzLoutre']
  const players = []
  for (const nickname of names) {
    const s = io(BASE, { transports: ['websocket'] })
    await once(s, 'connect')
    const ack = await ask(s, 'player:join', { pin, nickname })
    players.push({ nickname, sock: s, ...ack })
    log(`   ✔ ${nickname} a rejoint`)
  }

  // Observateurs
  players[0].sock.on('question:show', (q) =>
    log(`\n   👀 CE QUE VOIT LE JOUEUR :\n      ${JSON.stringify(q)}`))
  host.on('question:reveal', (r) =>
    log(`\n   🔓 RÉVÉLATION (hôte/écran) :\n      ${JSON.stringify(r)}`))
  host.on('scoreboard', (s) => log(`\n   🏆 Classement : ${JSON.stringify(s)}`))
  host.on('podium', (p) => log(`\n   🥇 PODIUM : ${JSON.stringify(p)}`))

  // NB : host:next démarre déjà la question suivante — on ne rappelle host:start que pour la 1re.
  const playRound = async (label, answers, { start } = { start: false }) => {
    hr(label)
    if (start) await ask(host, 'host:start', {})
    await sleep(300)
    // 1er répond vite, 2e plus lentement (bonus rapidité), 3e se trompe
    await ask(players[0].sock, 'player:answer', { answer: answers.fast })
    log('   ⚡ RenardAgile répond (vite, correct)')
    await sleep(600)
    await ask(players[1].sock, 'player:answer', { answer: answers.slow })
    log('   🐢 PixelDauphin répond (plus lentement, correct)')
    await ask(players[2].sock, 'player:answer', { answer: answers.wrong })
    log('   ❌ QuartzLoutre répond (faux)')
    await sleep(200)
    await ask(host, 'host:reveal', {})
    await sleep(400)
  }

  await playRound('4. Question 1 — QCM', {
    fast: { optionIndex: 1 }, slow: { optionIndex: 1 }, wrong: { optionIndex: 0 },
  }, { start: true })
  await ask(host, 'host:next', {}) // enchaîne ET démarre la Q2
  await playRound('5. Question 2 — Vrai / Faux', {
    fast: { value: true }, slow: { value: true }, wrong: { value: false },
  })
  hr('6. Fin de partie')
  await ask(host, 'host:next', {})
  await sleep(500)

  for (const p of players) p.sock.close()
  host.close()
  log('\n✅ Partie terminée — tout est persisté en base.\n')
  process.exit(0)
}

main().catch((e) => { console.error('ERREUR:', e); process.exit(1) })
