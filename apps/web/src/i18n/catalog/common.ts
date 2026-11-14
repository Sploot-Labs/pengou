import { defineCatalog } from './define'

export const common = defineCatalog({
  en: {
    // Titre de l'onglet (voir lang.ts) ; le français est celui de index.html.
    "Pengou, l'application : rejoindre ou animer une partie": 'Pengou, the app: join or host a game',
    Annuler: 'Cancel',
    Enregistrer: 'Save',
    Fermer: 'Close',
    Retour: 'Back',
    Réessayer: 'Try again',
    'Chargement…': 'Loading…',
    '{n} joueur': '{n} player',
    '{n} joueurs': '{n} players',
    "Langue de l'interface": 'Interface language',
    'La demande est invalide.': 'The request is invalid.',
    'Votre session a expiré. Reconnectez-vous.': 'Your session has expired. Please sign in again.',
    "Vous n'avez pas les droits pour cette action.": "You don't have permission for this action.",
    'Élément introuvable.': 'Item not found.',
    'Conflit avec une modification récente. Rechargez la page.': 'Conflict with a recent change. Reload the page.',
    'Envoi trop volumineux.': 'Upload too large.',
    'Trop de demandes. Patientez un instant puis réessayez.': 'Too many requests. Wait a moment and try again.',
    'Le serveur ne répond pas. Réessayez dans un instant.': "The server isn't responding. Try again in a moment.",
    'Le serveur a rencontré une erreur. Réessayez dans un instant.':
      'The server ran into an error. Try again in a moment.',
    'Erreur {status}': 'Error {status}',
  },
  es: {
    "Pengou, l'application : rejoindre ou animer une partie":
      'Pengou, la aplicación: únete a una partida u organiza una',
    Annuler: 'Cancelar',
    Enregistrer: 'Guardar',
    Fermer: 'Cerrar',
    Retour: 'Volver',
    Réessayer: 'Reintentar',
    'Chargement…': 'Cargando…',
    '{n} joueur': '{n} jugador',
    '{n} joueurs': '{n} jugadores',
    "Langue de l'interface": 'Idioma de la interfaz',
    'La demande est invalide.': 'La solicitud no es válida.',
    'Votre session a expiré. Reconnectez-vous.': 'Tu sesión ha caducado. Vuelve a iniciar sesión.',
    "Vous n'avez pas les droits pour cette action.": 'No tienes permiso para esta acción.',
    'Élément introuvable.': 'Elemento no encontrado.',
    'Conflit avec une modification récente. Rechargez la page.': 'Conflicto con un cambio reciente. Recarga la página.',
    'Envoi trop volumineux.': 'El envío es demasiado grande.',
    'Trop de demandes. Patientez un instant puis réessayez.':
      'Demasiadas solicitudes. Espera un momento y vuelve a intentarlo.',
    'Le serveur ne répond pas. Réessayez dans un instant.':
      'El servidor no responde. Inténtalo de nuevo en un momento.',
    'Le serveur a rencontré une erreur. Réessayez dans un instant.':
      'El servidor ha encontrado un error. Inténtalo de nuevo en un momento.',
    'Erreur {status}': 'Error {status}',
  },
})
