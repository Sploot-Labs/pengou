import { defineCatalog } from './define'

/** Animation en direct (hôte), grand écran, nuage de mots du grand écran et textes du temps réel. */
export const live = defineCatalog({
  en: {
    // Étapes de la partie (pastilles et titres)
    Lobby: 'Lobby',
    'Lecture en cours': 'Reading time',
    'Question en cours': 'Question in progress',
    Révélation: 'Reveal',
    Classement: 'Leaderboard',
    Podium: 'Podium',

    // Messages d'erreur et d'état
    "La connexion a été interrompue puis rétablie, mais cette partie ne peut plus être pilotée depuis cet onglet (le serveur ne permet pas de reprendre l'autorité hôte après une coupure). Retournez à l'éditeur et relancez la partie.":
      "The connection was interrupted and then restored, but this game can no longer be run from this tab (the server doesn't allow resuming host control after a drop). Go back to the editor and restart the game.",
    'Une erreur est survenue.': 'An error occurred.',
    "Impossible de reprendre cette partie : session introuvable, terminée, ou vous n'en êtes pas l'hôte.":
      'Unable to resume this game: game not found, finished, or you are not its host.',
    'Impossible de charger vos quiz.': 'Unable to load your quizzes.',
    "Identifiant de session manquant dans l'URL.": 'Session ID missing from the URL.',
    'Reprise de la partie…': 'Resuming the game…',
    'Connexion perdue, reconnexion…': 'Connection lost, reconnecting…',
    "Le serveur n'a pas répondu à « {event} » à temps.": 'The server did not respond to "{event}" in time.',
    '(réponse vide)': '(empty answer)',

    // Hôte : en-tête
    'Partie en direct': 'Live game',
    'PIN indisponible (session atteinte sans passer par « Lancer la partie »).':
      'PIN unavailable (session reached without going through "Start the game").',
    '{n} connecté': '{n} connected',
    '{n} connectés': '{n} connected',
    "Retour à l'éditeur": 'Back to the editor',

    // Hôte : lien grand écran
    'Génération…': 'Generating…',
    'Régénérer le lien grand écran': 'Regenerate the big screen link',
    'Grand écran': 'Big screen',
    'Lien du grand écran': 'Big screen link',
    Copier: 'Copy',
    'Lien copié.': 'Link copied.',
    'Copie impossible, sélectionnez et copiez le lien manuellement.':
      "Couldn't copy. Select and copy the link manually.",
    'À usage unique : ouvrez ce lien sur le projecteur AVANT de lancer la partie ; il devient invalide une fois utilisé.':
      'Single use: open this link on the projector BEFORE starting the game; it becomes invalid once used.',
    'Enchaînement automatique des étapes (10 s de pause sur le classement)':
      'Auto-advance through the steps (10 s pause on the leaderboard)',
    'Question suivante dans {n} s': 'Next question in {n} s',

    // Hôte : contrôleur
    'Contrôleur hôte live': 'Live host controller',
    'Pilotage de la partie': 'Game controls',
    'En attente des joueurs': 'Waiting for players',
    'Partagez le PIN sur le grand écran, ou le lien ci-dessus.': 'Share the PIN on the big screen, or the link above.',
    "Aucun joueur pour l'instant. La partie se lance dès qu'un joueur rejoint.":
      'No players yet. The game can start as soon as a player joins.',
    'Joueurs ayant rejoint la partie': 'Players who joined the game',
    '(hors ligne)': '(offline)',
    'Exclure {nickname}': 'Kick {nickname}',
    Exclure: 'Kick',
    'Exclure {nickname} de la partie ?': 'Kick {nickname} from the game?',
    '{n} joueur a rejoint la partie.': '{n} player has joined the game.',
    '{n} joueurs ont rejoint la partie.': '{n} players have joined the game.',
    "En attente d'au moins un joueur pour lancer la partie.": 'Waiting for at least one player to start the game.',
    'Lecture en cours… {n} s restantes': 'Reading time… {n} s left',
    '{n} / {total} a répondu': '{n} of {total} has answered',
    '{n} / {total} ont répondu': '{n} of {total} have answered',
    '{n} sur {total} a répondu.': '{n} of {total} has answered.',
    '{n} sur {total} ont répondu.': '{n} of {total} have answered.',
    'Clore le nuage': 'Close the word cloud',
    'Clore le sondage': 'Close the poll',
    'Révéler la réponse': 'Reveal the answer',
    'Révéler la réponse et passer directement au classement ? La réponse sera affichée aux joueurs et au grand écran.':
      'Reveal the answer and go straight to the leaderboard? The answer will be shown to players and on the big screen.',
    'Passer directement à la suite, sans afficher les résultats ?': 'Skip ahead without showing the results?',
    Passer: 'Skip',
    'Révélation : {prompt}': 'Reveal: {prompt}',
    'Nuage de mots figé.': 'Word cloud frozen.',
    'Sondage clos.': 'Poll closed.',
    'Réponse révélée : {answer}': 'Answer revealed: {answer}',
    'Afficher le classement': 'Show the leaderboard',
    Suivant: 'Next',
    'Réponses et distribution': 'Answers and distribution',
    'Aucune réponse reçue pour cette question.': 'No answers received for this question.',
    '{percent}\u00a0%': '{percent}%',
    "Le classement s'affichera après la première question.": 'The leaderboard will appear after the first question.',
    'Top joueurs': 'Top players',
    '{score} pts': '{score} pts',
    'Tous les joueurs ({n})': 'All players ({n})',
    'Quiz de la prochaine partie': 'Quiz for the next game',
    'Relancer une partie': 'Start another game',
    'Aucun quiz disponible à relancer.': 'No quiz available to replay.',
    'Dernier classement connu': 'Last known leaderboard',
    'Joueurs de la partie': 'Players in the game',

    // Grand écran
    'Le quiz en direct, open-source.': 'The open-source live quiz.',
    "Lien invalide : jeton d'affichage manquant dans l'URL.": 'Invalid link: display token missing from the URL.',
    "Lien grand écran expiré après une coupure réseau. Demandez un nouveau lien à l'hôte.":
      'Big screen link expired after a network drop. Ask the host for a new link.',
    'Connexion au grand écran impossible.': 'Unable to connect to the big screen.',
    'Générez un nouveau lien depuis le contrôleur hôte (« Grand écran »).':
      'Generate a new link from the host controller ("Big screen").',
    'Connexion au grand écran…': 'Connecting to the big screen…',
    'De {min} à {max}': 'From {min} to {max}',
    'Réponse libre : tapez sur votre mobile': 'Free text: type on your phone',
    '(bonne réponse)': '(correct answer)',
    '{n} réponse': '{n} answer',
    '{n} réponses': '{n} answers',
    'Rejoignez sur': 'Join at',
    'code banquise': 'ice floe code',
    "PIN indisponible, demandez-le à l'hôte.": 'PIN unavailable, ask the host for it.',
    'Rejoignez en 5 secondes, aucune appli à installer. Vos données restent chez vous.':
      'Join in 5 seconds, no app to install. Your data stays with you.',
    'En attente de la colonie… Saisissez le code banquise pour rejoindre.':
      'Waiting for the colony… Enter the ice floe code to join.',
    déconnecté: 'disconnected',
    'Lecture : {n} s restantes': 'Reading time: {n} s left',
    'Résultat indisponible pour cette question, la suivante arrive.':
      'Result unavailable for this question, the next one is coming.',

    // Nuage de mots du grand écran
    '{n} fois': '{n} times',
    '{n} fois#one': '{n} time',
    'Mots les plus proposés': 'Most suggested words',
    '{rank}. {word}, {times}': '{rank}. {word}, {times}',
  },
  es: {
    Lobby: 'Sala de espera',
    'Lecture en cours': 'Lectura en curso',
    'Question en cours': 'Pregunta en curso',
    Révélation: 'Revelación',
    Classement: 'Clasificación',
    Podium: 'Podio',

    "La connexion a été interrompue puis rétablie, mais cette partie ne peut plus être pilotée depuis cet onglet (le serveur ne permet pas de reprendre l'autorité hôte après une coupure). Retournez à l'éditeur et relancez la partie.":
      'La conexión se interrumpió y se restableció, pero esta partida ya no se puede dirigir desde esta pestaña (el servidor no permite recuperar el control de anfitrión tras un corte). Vuelve al editor y reinicia la partida.',
    'Une erreur est survenue.': 'Se ha producido un error.',
    "Impossible de reprendre cette partie : session introuvable, terminée, ou vous n'en êtes pas l'hôte.":
      'No se puede reanudar esta partida: la partida no existe, ha terminado o no eres su anfitrión.',
    'Impossible de charger vos quiz.': 'No se pueden cargar tus quiz.',
    "Identifiant de session manquant dans l'URL.": 'Falta el identificador de sesión en la URL.',
    'Reprise de la partie…': 'Reanudando la partida…',
    'Connexion perdue, reconnexion…': 'Conexión perdida, reconectando…',
    "Le serveur n'a pas répondu à « {event} » à temps.": 'El servidor no respondió a «{event}» a tiempo.',
    '(réponse vide)': '(respuesta vacía)',

    'Partie en direct': 'Partida en vivo',
    'PIN indisponible (session atteinte sans passer par « Lancer la partie »).':
      'PIN no disponible (se accedió a la sesión sin pasar por «Iniciar la partida»).',
    '{n} connecté': '{n} conectado',
    '{n} connectés': '{n} conectados',
    "Retour à l'éditeur": 'Volver al editor',

    'Génération…': 'Generando…',
    'Régénérer le lien grand écran': 'Regenerar el enlace de la pantalla grande',
    'Grand écran': 'Pantalla grande',
    'Lien du grand écran': 'Enlace de la pantalla grande',
    Copier: 'Copiar',
    'Lien copié.': 'Enlace copiado.',
    'Copie impossible, sélectionnez et copiez le lien manuellement.':
      'No se pudo copiar. Selecciona y copia el enlace manualmente.',
    'À usage unique : ouvrez ce lien sur le projecteur AVANT de lancer la partie ; il devient invalide une fois utilisé.':
      'De un solo uso: abre este enlace en el proyector ANTES de iniciar la partida; deja de ser válido una vez usado.',
    'Enchaînement automatique des étapes (10 s de pause sur le classement)':
      'Avance automática de las etapas (10 s de pausa en la clasificación)',
    'Question suivante dans {n} s': 'Siguiente pregunta en {n} s',

    'Contrôleur hôte live': 'Controlador del anfitrión en vivo',
    'Pilotage de la partie': 'Control de la partida',
    'En attente des joueurs': 'Esperando a los jugadores',
    'Partagez le PIN sur le grand écran, ou le lien ci-dessus.':
      'Comparte el PIN en la pantalla grande o el enlace de arriba.',
    "Aucun joueur pour l'instant. La partie se lance dès qu'un joueur rejoint.":
      'Todavía no hay jugadores. La partida puede empezar en cuanto se una un jugador.',
    'Joueurs ayant rejoint la partie': 'Jugadores que se han unido a la partida',
    '(hors ligne)': '(sin conexión)',
    'Exclure {nickname}': 'Expulsar a {nickname}',
    Exclure: 'Expulsar',
    'Exclure {nickname} de la partie ?': '¿Expulsar a {nickname} de la partida?',
    '{n} joueur a rejoint la partie.': '{n} jugador se ha unido a la partida.',
    '{n} joueurs ont rejoint la partie.': '{n} jugadores se han unido a la partida.',
    "En attente d'au moins un joueur pour lancer la partie.":
      'Esperando a que se una al menos un jugador para iniciar la partida.',
    'Lecture en cours… {n} s restantes': 'Lectura en curso… quedan {n} s',
    '{n} / {total} a répondu': '{n} de {total} ha respondido',
    '{n} / {total} ont répondu': '{n} de {total} han respondido',
    '{n} sur {total} a répondu.': '{n} de {total} ha respondido.',
    '{n} sur {total} ont répondu.': '{n} de {total} han respondido.',
    'Clore le nuage': 'Cerrar la nube de palabras',
    'Clore le sondage': 'Cerrar la encuesta',
    'Révéler la réponse': 'Revelar la respuesta',
    'Révéler la réponse et passer directement au classement ? La réponse sera affichée aux joueurs et au grand écran.':
      '¿Revelar la respuesta y pasar directamente a la clasificación? La respuesta se mostrará a los jugadores y en la pantalla grande.',
    'Passer directement à la suite, sans afficher les résultats ?':
      '¿Pasar directamente a lo siguiente, sin mostrar los resultados?',
    Passer: 'Saltar',
    'Révélation : {prompt}': 'Revelación: {prompt}',
    'Nuage de mots figé.': 'Nube de palabras fijada.',
    'Sondage clos.': 'Encuesta cerrada.',
    'Réponse révélée : {answer}': 'Respuesta revelada: {answer}',
    'Afficher le classement': 'Mostrar la clasificación',
    Suivant: 'Siguiente',
    'Réponses et distribution': 'Respuestas y distribución',
    'Aucune réponse reçue pour cette question.': 'No se ha recibido ninguna respuesta a esta pregunta.',
    '{percent}\u00a0%': '{percent}\u00a0%',
    "Le classement s'affichera après la première question.": 'La clasificación aparecerá tras la primera pregunta.',
    'Top joueurs': 'Mejores jugadores',
    '{score} pts': '{score} pts',
    'Tous les joueurs ({n})': 'Todos los jugadores ({n})',
    'Quiz de la prochaine partie': 'Quiz de la próxima partida',
    'Relancer une partie': 'Iniciar otra partida',
    'Aucun quiz disponible à relancer.': 'No hay ningún quiz disponible para repetir.',
    'Dernier classement connu': 'Última clasificación conocida',
    'Joueurs de la partie': 'Jugadores de la partida',

    'Le quiz en direct, open-source.': 'El quiz en vivo de código abierto.',
    "Lien invalide : jeton d'affichage manquant dans l'URL.":
      'Enlace no válido: falta el token de visualización en la URL.',
    "Lien grand écran expiré après une coupure réseau. Demandez un nouveau lien à l'hôte.":
      'El enlace de la pantalla grande ha caducado tras un corte de red. Pide un nuevo enlace al anfitrión.',
    'Connexion au grand écran impossible.': 'No se puede conectar con la pantalla grande.',
    'Générez un nouveau lien depuis le contrôleur hôte (« Grand écran »).':
      'Genera un nuevo enlace desde el controlador del anfitrión («Pantalla grande»).',
    'Connexion au grand écran…': 'Conectando con la pantalla grande…',
    'De {min} à {max}': 'De {min} a {max}',
    'Réponse libre : tapez sur votre mobile': 'Respuesta libre: escribe en tu móvil',
    '(bonne réponse)': '(respuesta correcta)',
    '{n} réponse': '{n} respuesta',
    '{n} réponses': '{n} respuestas',
    'Rejoignez sur': 'Únete en',
    'code banquise': 'código del témpano',
    "PIN indisponible, demandez-le à l'hôte.": 'PIN no disponible, pídeselo al anfitrión.',
    'Rejoignez en 5 secondes, aucune appli à installer. Vos données restent chez vous.':
      'Únete en 5 segundos, sin instalar ninguna aplicación. Tus datos se quedan contigo.',
    'En attente de la colonie… Saisissez le code banquise pour rejoindre.':
      'Esperando a la colonia… Introduce el código del témpano para unirte.',
    déconnecté: 'desconectado',
    'Lecture : {n} s restantes': 'Lectura: quedan {n} s',
    'Résultat indisponible pour cette question, la suivante arrive.':
      'Resultado no disponible para esta pregunta, enseguida llega la siguiente.',

    '{n} fois': '{n} veces',
    '{n} fois#one': '{n} vez',
    'Mots les plus proposés': 'Palabras más propuestas',
    '{rank}. {word}, {times}': '{rank}. {word}, {times}',
  },
})
