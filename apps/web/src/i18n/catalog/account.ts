import { defineCatalog } from './define'

/** Comptes, coquille de l'application et composants d'interface partagés. */
export const account = defineCatalog({
  en: {
    // Coquille et garde d'accès
    'Aller au contenu': 'Skip to content',
    'Vérification de la session…': 'Checking your session…',
    "Impossible de vérifier votre session (problème réseau ou serveur temporairement indisponible). Vous n'avez pas été déconnecté, réessayez.":
      'Unable to check your session (network problem or server temporarily unavailable). You have not been signed out, try again.',
    'Chargement de votre espace…': 'Loading your workspace…',

    // Composants partagés
    'Vouliez-vous dire': 'Did you mean',
    ' ?': '?',
    "(s'ouvre dans un nouvel onglet)": '(opens in a new tab)',
    'Après la démonstration': 'After the demo',
    "La démonstration s'arrête ici et rien n'est conservé. Avec un compte gratuit, vous créez vos propres quiz et vous gardez vos résultats.":
      'The demo ends here and nothing is saved. With a free account, you can create your own quizzes and keep your results.',
    'Créer mon compte pour faire mes propres quiz': 'Create my account to make my own quizzes',
    "Confirmez votre adresse e-mail pour créer d'autres quiz.": 'Confirm your email address to create more quizzes.',
    "Renvoyer l'e-mail": 'Resend the email',
    'E-mail envoyé': 'Email sent',
    "L'e-mail n'a pas pu partir. Réessayez.": 'The email could not be sent. Try again.',
    'Adresse e-mail confirmée.': 'Email address confirmed.',
    "Confirmation de l'adresse e-mail": 'Email address confirmation',
    "Confirmez votre adresse pour créer plus d'un quiz.": 'Confirm your address to create more than one quiz.',
    propriétaire: 'owner',
    admin: 'admin',
    membre: 'member',
    administrateur: 'administrator',
    'Créer un workspace': 'Create a workspace',
    'Workspace actif': 'Active workspace',
    Gérer: 'Manage',

    // ui.tsx
    "Pengou, retour à l'accueil": 'Pengou, back to home',
    étoile: 'star',
    goutte: 'drop',
    vague: 'wave',
    flocon: 'snowflake',
    ', réponse {shape}': ', answer {shape}',
    'Bonne réponse': 'Correct answer',
    'Réponse incorrecte': 'Incorrect answer',
    'Temps restant : {n} seconde': 'Time left: {n} second',
    'Temps restant : {n} secondes': 'Time left: {n} seconds',
    'Code PIN de la partie': 'Game PIN',
    '{label} : {pin}': '{label}: {pin}',
    'QR code pour rejoindre la partie sur {url}': 'QR code to join the game at {url}',
    'Scannez pour rejoindre, ou allez sur': 'Scan to join, or go to',
    'Activer le son': 'Turn sound on',
    'Couper le son': 'Turn sound off',
    'Son coupé': 'Sound off',
    'Son activé': 'Sound on',

    // Nuage de mots (composant partagé)
    '{n} participant a proposé': '{n} participant suggested',
    '{n} participants ont proposé': '{n} participants suggested',
    '{n} mot reçu': '{n} word received',
    '{n} mots reçus': '{n} words received',
    '(100 mots les plus cités)': '(top 100 words)',
    'En attente des premières idées…': 'Waiting for the first ideas…',
    'Nuage de mots': 'Word cloud',
    'Retirer « {word} »': 'Remove "{word}"',

    // Crédits des questions (composants partagés)
    'Crédits :': 'Credits:',
    'Traduit par {translator}': 'Translated by {translator}',
    "D'après": 'Based on',
    ', traduit par {translator}': ', translated by {translator}',
    'Crédits et licence': 'Credits and license',
    'Crédits et licences': 'Credits and licenses',
    ' et ': ' and ',
    'Questions issues {names}.': 'Questions from {names}.',
    'Questions issues {names}, licence {licenses}. Crédits : {url}':
      'Questions from {names}, license {licenses}. Credits: {url}',
    'Questions issues {names}, licences {licenses}. Crédits : {url}':
      'Questions from {names}, licenses {licenses}. Credits: {url}',
    '{from} à {to}': '{from} to {to}',
    'Sources et licences': 'Sources and licenses',
    "Quiz d'origine :": 'Original quiz:',
    'Toutes les questions :': 'All questions:',
    'Questions {positions} :': 'Questions {positions}:',
    'Question {positions} :': 'Question {positions}:',
    Licences: 'Licenses',
    Licence: 'License',
    'Vos modifications de ces contenus restent sous cette licence.':
      'Your changes to this content stay under this license.',

    // Connexion
    'Adresse e-mail invalide.': 'Invalid email address.',
    'Mot de passe requis.': 'Password required.',
    'Connexion impossible. Vérifiez votre connexion et réessayez.':
      "Couldn't sign in. Check your connection and try again.",
    Connexion: 'Sign in',
    'Content de vous revoir : vos parties vous attendent.': 'Good to see you again: your games are waiting.',
    'Mot de passe modifié. Vous pouvez vous connecter.': 'Password changed. You can now sign in.',
    'E-mail': 'Email',
    'Mot de passe': 'Password',
    'Mot de passe oublié ?': 'Forgot your password?',
    'Connexion…': 'Signing in…',
    'Se connecter': 'Sign in',
    'Pas encore de compte ?': 'No account yet?',
    'Créer un compte': 'Create an account',

    // Inscription
    'Nom requis.': 'Name required.',
    'Mot de passe trop court : {min} caractères minimum, {count} saisis.':
      'Password too short: {min} characters minimum, {count} entered.',
    'Confirmez que vous avez 15 ans ou plus.': 'Confirm that you are 15 or older.',
    "Acceptez les conditions d'utilisation pour créer votre compte.": 'Accept the terms of use to create your account.',
    'Inscription impossible. Vérifiez votre connexion et réessayez.':
      "Couldn't sign you up. Check your connection and try again.",
    Inscription: 'Sign up',
    'On vous fait de la place : quelques infos et votre compte est prêt.':
      "We're making room for you: a few details and your account is ready.",
    Nom: 'Name',
    'Masquer le mot de passe': 'Hide password',
    'Afficher le mot de passe': 'Show password',
    Masquer: 'Hide',
    Afficher: 'Show',
    '{min} caractères minimum.': '{min} characters minimum.',
    "Impossible de charger les conditions d'utilisation. Vérifiez votre connexion et réessayez.":
      "Couldn't load the terms of use. Check your connection and try again.",
    "J'ai 15 ans ou plus": "I'm 15 or older",
    "J'accepte les": 'I accept the',
    "conditions d'utilisation": 'terms of use',
    La: 'The',
    'politique de confidentialité': 'privacy policy',
    'explique comment vos données sont traitées.': 'explains how your data is handled.',
    'Inscription…': 'Signing up…',
    "S'inscrire": 'Sign up',
    'Déjà un compte ?': 'Already have an account?',

    // Mot de passe oublié
    'Trop de demandes, réessayez dans quelques minutes.': 'Too many requests, try again in a few minutes.',
    'Mot de passe oublié': 'Forgot password',
    "La réinitialisation par e-mail n'est pas disponible sur cette instance. Contactez l'administrateur.":
      'Password reset by email is not available on this instance. Contact the administrator.',
    'Retour à la connexion': 'Back to sign in',
    'Indiquez votre adresse e-mail : nous vous enverrons un lien pour choisir un nouveau mot de passe.':
      'Enter your email address: we will send you a link to choose a new password.',
    'Si un compte existe pour cette adresse, un e-mail vient de partir. Pensez à vérifier les indésirables.':
      'If an account exists for this address, an email has just been sent. Remember to check your spam folder.',
    'Envoi…': 'Sending…',
    'Envoyer le lien': 'Send the link',

    // Nouveau mot de passe
    'Nouveau mot de passe': 'New password',
    'Ce lien a expiré ou a déjà servi.': 'This link has expired or has already been used.',
    'Faire une nouvelle demande': 'Request a new link',
    'Au moins {min} caractères.': 'At least {min} characters.',
    'Les mots de passe ne correspondent pas.': 'The passwords do not match.',
    'Enregistrement impossible. Vérifiez votre connexion et réessayez.':
      "Couldn't save. Check your connection and try again.",
    "Choisissez un mot de passe d'au moins {min} caractères.": 'Choose a password of at least {min} characters.',
    'Confirmer le mot de passe': 'Confirm password',
    'Enregistrement…': 'Saving…',

    // Revalidation des conditions d'utilisation
    "Cochez la case pour accepter les conditions d'utilisation.": 'Check the box to accept the terms of use.',
    "Les conditions d'utilisation ont changé": 'The terms of use have changed',
    'Une nouvelle version, datée du {date}, est en vigueur. Lisez-la puis acceptez-la pour continuer à utiliser votre compte.':
      'A new version, dated {date}, is in effect. Read it and accept it to keep using your account.',
    "Chargement des conditions d'utilisation…": 'Loading the terms of use…',
    'Lire les': 'Read the',
    "J'accepte les conditions d'utilisation": 'I accept the terms of use',
    'Accepter et continuer': 'Accept and continue',
    'Déconnexion…': 'Signing out…',
    'Se déconnecter': 'Sign out',

    // Invitation
    'Invitation introuvable.': 'Invitation not found.',
    "Impossible d'accepter l'invitation.": "Couldn't accept the invitation.",
    Invitation: 'Invitation',
    'Vous êtes invité·e à rejoindre': "You're invited to join",
    'en tant que': 'as',
    "Chargement de l'invitation…": 'Loading the invitation…',
    "Retour à l'accueil": 'Back to home',
    'Cette invitation a expiré. Demandez-en une nouvelle.': 'This invitation has expired. Ask for a new one.',
    'Cette invitation a déjà été utilisée ou révoquée.': 'This invitation has already been used or revoked.',
    'Connecté·e en tant que': 'Signed in as',
    'Acceptation…': 'Accepting…',
    'Rejoindre {name}': 'Join {name}',
    'Connectez-vous ou créez un compte pour rejoindre ce workspace.':
      'Sign in or create an account to join this workspace.',
    'Revenez sur ce lien une fois connecté·e pour finaliser.':
      "Come back to this link once you're signed in to finish.",

    // Erreur de routage
    "Cette page n'existe pas.": "This page doesn't exist.",
    "Une erreur inattendue est survenue. Rechargez la page ; si le problème persiste, revenez à l'accueil.":
      'An unexpected error occurred. Reload the page; if the problem persists, go back to the home page.',
    'Recharger la page': 'Reload the page',
    "← Retour à l'accueil": '← Back to home',

    // Crédits
    'Les questions de la bibliothèque viennent de bases libres, écrites par des bénévoles. Merci à elles et à eux.':
      'The library questions come from open databases, written by volunteers. Thank you to all of them.',
    "Les questions en français viennent d'": 'The questions in French come from ',
    ", fournisseur de contenu libre coordonné par Philippe Bresoux. Le rédacteur de chaque quiz et le lien vers sa page d'origine figurent dans l'aperçu du quiz et dans l'éditeur.":
      ', a free content provider coordinated by Philippe Bresoux. The author of each quiz and the link to its original page appear in the quiz preview and in the editor.',
    "Pengou a adapté ces quiz : format de Pengou, classement par thème, difficulté et public, regroupement en quiz de 10 à 20 questions, retrait des anecdotes et des questions en double, dépassées ou erronées. Le texte des questions et des propositions n'est pas modifié. La liste des quiz repris, avec leur rédacteur, est dans le":
      'Pengou adapted these quizzes: Pengou format, sorting by theme, difficulty and audience, grouping into quizzes of 10 to 20 questions, removal of fun facts and of duplicate, outdated or erroneous questions. The text of the questions and options is unchanged. The list of quizzes included, with their authors, is in the',
    "fichier de licence d'OpenQuizzDB": 'OpenQuizzDB license file',
    "Les questions en anglais viennent de l'": 'The questions in English come from the ',
    ', base contributive créée par PIXELTAIL GAMES LLC et ses contributeurs.':
      ', a community-built database created by PIXELTAIL GAMES LLC and its contributors.',
    "Pengou a adapté ces questions : format de Pengou, classement par thème, difficulté et public, regroupement en quiz de 15 questions, retrait des questions en double. Le texte des questions et des réponses n'est pas modifié. Le détail est dans le":
      'Pengou adapted these questions: Pengou format, sorting by theme, difficulty and audience, grouping into quizzes of 15 questions, removal of duplicate questions. The text of the questions and answers is unchanged. The details are in the',
    "fichier de licence de l'Open Trivia Database": 'Open Trivia Database license file',
    Traductions: 'Translations',
    "Sploot Labs traduit une partie de ces questions, avec l'aide d'une IA : celles de l'Open Trivia Database en français, celles d'OpenQuizzDB en anglais. Le type, le thème, la difficulté et la bonne réponse restent ceux de l'original. Les questions qui n'ont pas de sens une fois traduites (jeux de mots, orthographe) sont écartées. Voir les fichiers de licence des traductions":
      'Sploot Labs translates some of these questions, with the help of an AI: those from the Open Trivia Database into French, those from OpenQuizzDB into English. The type, theme, difficulty and correct answer stay those of the original. Questions that make no sense once translated (wordplay, spelling) are left out. See the license files of the translations',
    'en français': 'in French',
    'en anglais': 'in English',
    'Ces questions, leurs adaptations et leurs traductions sont sous licence':
      'These questions, their adaptations and their translations are licensed under',
    'Vous pouvez les copier, les modifier et les partager, y compris dans vos propres quiz, à condition de citer leur source et de partager vos modifications sous la même licence.':
      'You may copy, modify and share them, including in your own quizzes, provided you cite their source and share your changes under the same license.',
    "Quand vous copiez un quiz ou des questions de la bibliothèque, Pengou garde la source de chaque question et l'affiche dans l'éditeur. En fin de partie, le grand écran crédite les bases d'où viennent les questions. Le code de Pengou est sous licence Apache-2.0, qui ne s'applique pas aux questions.":
      'When you copy a quiz or questions from the library, Pengou keeps the source of each question and shows it in the editor. At the end of a game, the big screen credits the databases the questions come from. The Pengou code is under the Apache-2.0 license, which does not apply to the questions.',
  },
  es: {
    // Coquille et garde d'accès
    'Aller au contenu': 'Ir al contenido',
    'Vérification de la session…': 'Comprobando tu sesión…',
    "Impossible de vérifier votre session (problème réseau ou serveur temporairement indisponible). Vous n'avez pas été déconnecté, réessayez.":
      'No se ha podido comprobar tu sesión (problema de red o servidor no disponible temporalmente). No se ha cerrado tu sesión, inténtalo de nuevo.',
    'Chargement de votre espace…': 'Cargando tu espacio de trabajo…',

    // Composants partagés
    'Vouliez-vous dire': '¿Quisiste decir',
    ' ?': '?',
    "(s'ouvre dans un nouvel onglet)": '(se abre en una pestaña nueva)',
    'Après la démonstration': 'Después de la demostración',
    "La démonstration s'arrête ici et rien n'est conservé. Avec un compte gratuit, vous créez vos propres quiz et vous gardez vos résultats.":
      'La demostración termina aquí y no se guarda nada. Con una cuenta gratuita, creas tus propios quiz y conservas tus resultados.',
    'Créer mon compte pour faire mes propres quiz': 'Crear mi cuenta para hacer mis propios quiz',
    "Confirmez votre adresse e-mail pour créer d'autres quiz.": 'Confirma tu correo electrónico para crear más quiz.',
    "Renvoyer l'e-mail": 'Reenviar el correo',
    'E-mail envoyé': 'Correo enviado',
    "L'e-mail n'a pas pu partir. Réessayez.": 'No se ha podido enviar el correo. Inténtalo de nuevo.',
    'Adresse e-mail confirmée.': 'Correo electrónico confirmado.',
    "Confirmation de l'adresse e-mail": 'Confirmación del correo electrónico',
    "Confirmez votre adresse pour créer plus d'un quiz.": 'Confirma tu dirección para crear más de un quiz.',
    propriétaire: 'propietario',
    admin: 'admin',
    membre: 'miembro',
    administrateur: 'administrador',
    'Créer un workspace': 'Crear un espacio de trabajo',
    'Workspace actif': 'Espacio de trabajo activo',
    Gérer: 'Gestionar',

    // ui.tsx
    "Pengou, retour à l'accueil": 'Pengou, volver al inicio',
    étoile: 'estrella',
    goutte: 'gota',
    vague: 'ola',
    flocon: 'copo de nieve',
    ', réponse {shape}': ', respuesta {shape}',
    'Bonne réponse': 'Respuesta correcta',
    'Réponse incorrecte': 'Respuesta incorrecta',
    'Temps restant : {n} seconde': 'Tiempo restante: {n} segundo',
    'Temps restant : {n} secondes': 'Tiempo restante: {n} segundos',
    'Code PIN de la partie': 'Código PIN de la partida',
    '{label} : {pin}': '{label}: {pin}',
    'QR code pour rejoindre la partie sur {url}': 'Código QR para unirte a la partida en {url}',
    'Scannez pour rejoindre, ou allez sur': 'Escanea para unirte o ve a',
    'Activer le son': 'Activar el sonido',
    'Couper le son': 'Desactivar el sonido',
    'Son coupé': 'Sonido silenciado',
    'Son activé': 'Sonido activado',

    // Nuage de mots (composant partagé)
    '{n} participant a proposé': '{n} participante ha propuesto',
    '{n} participants ont proposé': '{n} participantes han propuesto',
    '{n} mot reçu': '{n} palabra recibida',
    '{n} mots reçus': '{n} palabras recibidas',
    '(100 mots les plus cités)': '(las 100 palabras más citadas)',
    'En attente des premières idées…': 'Esperando las primeras ideas…',
    'Nuage de mots': 'Nube de palabras',
    'Retirer « {word} »': 'Quitar «{word}»',

    // Crédits des questions (composants partagés)
    'Crédits :': 'Créditos:',
    'Traduit par {translator}': 'Traducido por {translator}',
    "D'après": 'Basado en',
    ', traduit par {translator}': ', traducido por {translator}',
    'Crédits et licence': 'Créditos y licencia',
    'Crédits et licences': 'Créditos y licencias',
    ' et ': ' y ',
    'Questions issues {names}.': 'Preguntas de {names}.',
    'Questions issues {names}, licence {licenses}. Crédits : {url}':
      'Preguntas de {names}, licencia {licenses}. Créditos: {url}',
    'Questions issues {names}, licences {licenses}. Crédits : {url}':
      'Preguntas de {names}, licencias {licenses}. Créditos: {url}',
    '{from} à {to}': '{from} a {to}',
    'Sources et licences': 'Fuentes y licencias',
    "Quiz d'origine :": 'Quiz de origen:',
    'Toutes les questions :': 'Todas las preguntas:',
    'Questions {positions} :': 'Preguntas {positions}:',
    'Question {positions} :': 'Pregunta {positions}:',
    Licences: 'Licencias',
    Licence: 'Licencia',
    'Vos modifications de ces contenus restent sous cette licence.':
      'Tus modificaciones de estos contenidos siguen bajo esta licencia.',

    // Connexion
    'Adresse e-mail invalide.': 'Correo electrónico no válido.',
    'Mot de passe requis.': 'Contraseña obligatoria.',
    'Connexion impossible. Vérifiez votre connexion et réessayez.':
      'No se ha podido iniciar sesión. Comprueba tu conexión e inténtalo de nuevo.',
    Connexion: 'Iniciar sesión',
    'Content de vous revoir : vos parties vous attendent.': 'Te damos la bienvenida de nuevo: tus partidas te esperan.',
    'Mot de passe modifié. Vous pouvez vous connecter.': 'Contraseña modificada. Ya puedes iniciar sesión.',
    'E-mail': 'Correo electrónico',
    'Mot de passe': 'Contraseña',
    'Mot de passe oublié ?': '¿Olvidaste tu contraseña?',
    'Connexion…': 'Iniciando sesión…',
    'Se connecter': 'Iniciar sesión',
    'Pas encore de compte ?': '¿Aún no tienes cuenta?',
    'Créer un compte': 'Crear una cuenta',

    // Inscription
    'Nom requis.': 'Nombre obligatorio.',
    'Mot de passe trop court : {min} caractères minimum, {count} saisis.':
      'Contraseña demasiado corta: mínimo {min} caracteres, {count} introducidos.',
    'Confirmez que vous avez 15 ans ou plus.': 'Confirma que tienes 15 años o más.',
    "Acceptez les conditions d'utilisation pour créer votre compte.":
      'Acepta las condiciones de uso para crear tu cuenta.',
    'Inscription impossible. Vérifiez votre connexion et réessayez.':
      'No se ha podido completar el registro. Comprueba tu conexión e inténtalo de nuevo.',
    Inscription: 'Registro',
    'On vous fait de la place : quelques infos et votre compte est prêt.':
      'Te hacemos un hueco: unos pocos datos y tu cuenta está lista.',
    Nom: 'Nombre',
    'Masquer le mot de passe': 'Ocultar la contraseña',
    'Afficher le mot de passe': 'Mostrar la contraseña',
    Masquer: 'Ocultar',
    Afficher: 'Mostrar',
    '{min} caractères minimum.': 'Mínimo {min} caracteres.',
    "Impossible de charger les conditions d'utilisation. Vérifiez votre connexion et réessayez.":
      'No se han podido cargar las condiciones de uso. Comprueba tu conexión e inténtalo de nuevo.',
    "J'ai 15 ans ou plus": 'Tengo 15 años o más',
    "J'accepte les": 'Acepto las',
    "conditions d'utilisation": 'condiciones de uso',
    La: 'La',
    'politique de confidentialité': 'política de privacidad',
    'explique comment vos données sont traitées.': 'explica cómo se tratan tus datos.',
    'Inscription…': 'Registrando…',
    "S'inscrire": 'Registrarme',
    'Déjà un compte ?': '¿Ya tienes cuenta?',

    // Mot de passe oublié
    'Trop de demandes, réessayez dans quelques minutes.': 'Demasiadas solicitudes, inténtalo de nuevo en unos minutos.',
    'Mot de passe oublié': '¿Olvidaste tu contraseña?',
    "La réinitialisation par e-mail n'est pas disponible sur cette instance. Contactez l'administrateur.":
      'El restablecimiento por correo electrónico no está disponible en esta instancia. Contacta con el administrador.',
    'Retour à la connexion': 'Volver al inicio de sesión',
    'Indiquez votre adresse e-mail : nous vous enverrons un lien pour choisir un nouveau mot de passe.':
      'Indica tu correo electrónico: te enviaremos un enlace para elegir una contraseña nueva.',
    'Si un compte existe pour cette adresse, un e-mail vient de partir. Pensez à vérifier les indésirables.':
      'Si existe una cuenta con esta dirección, acabamos de enviarte un correo. Recuerda revisar la carpeta de spam.',
    'Envoi…': 'Enviando…',
    'Envoyer le lien': 'Enviar el enlace',

    // Nouveau mot de passe
    'Nouveau mot de passe': 'Contraseña nueva',
    'Ce lien a expiré ou a déjà servi.': 'Este enlace ha caducado o ya se ha usado.',
    'Faire une nouvelle demande': 'Solicitar un enlace nuevo',
    'Au moins {min} caractères.': 'Al menos {min} caracteres.',
    'Les mots de passe ne correspondent pas.': 'Las contraseñas no coinciden.',
    'Enregistrement impossible. Vérifiez votre connexion et réessayez.':
      'No se ha podido guardar. Comprueba tu conexión e inténtalo de nuevo.',
    "Choisissez un mot de passe d'au moins {min} caractères.": 'Elige una contraseña de al menos {min} caracteres.',
    'Confirmer le mot de passe': 'Confirmar la contraseña',
    'Enregistrement…': 'Guardando…',

    // Revalidation des conditions d'utilisation
    "Cochez la case pour accepter les conditions d'utilisation.":
      'Marca la casilla para aceptar las condiciones de uso.',
    "Les conditions d'utilisation ont changé": 'Las condiciones de uso han cambiado',
    'Une nouvelle version, datée du {date}, est en vigueur. Lisez-la puis acceptez-la pour continuer à utiliser votre compte.':
      'Está en vigor una nueva versión, con fecha del {date}. Léela y acéptala para seguir usando tu cuenta.',
    "Chargement des conditions d'utilisation…": 'Cargando las condiciones de uso…',
    'Lire les': 'Lee las',
    "J'accepte les conditions d'utilisation": 'Acepto las condiciones de uso',
    'Accepter et continuer': 'Aceptar y continuar',
    'Déconnexion…': 'Cerrando sesión…',
    'Se déconnecter': 'Cerrar sesión',

    // Invitation
    'Invitation introuvable.': 'Invitación no encontrada.',
    "Impossible d'accepter l'invitation.": 'No se ha podido aceptar la invitación.',
    Invitation: 'Invitación',
    'Vous êtes invité·e à rejoindre': 'Te han invitado a unirte a',
    'en tant que': 'como',
    "Chargement de l'invitation…": 'Cargando la invitación…',
    "Retour à l'accueil": 'Volver al inicio',
    'Cette invitation a expiré. Demandez-en une nouvelle.': 'Esta invitación ha caducado. Pide una nueva.',
    'Cette invitation a déjà été utilisée ou révoquée.': 'Esta invitación ya se ha usado o se ha revocado.',
    'Connecté·e en tant que': 'Sesión iniciada como',
    'Acceptation…': 'Aceptando…',
    'Rejoindre {name}': 'Unirte a {name}',
    'Connectez-vous ou créez un compte pour rejoindre ce workspace.':
      'Inicia sesión o crea una cuenta para unirte a este espacio de trabajo.',
    'Revenez sur ce lien une fois connecté·e pour finaliser.':
      'Vuelve a este enlace cuando hayas iniciado sesión para terminar.',

    // Erreur de routage
    "Cette page n'existe pas.": 'Esta página no existe.',
    "Une erreur inattendue est survenue. Rechargez la page ; si le problème persiste, revenez à l'accueil.":
      'Se ha producido un error inesperado. Recarga la página; si el problema persiste, vuelve al inicio.',
    'Recharger la page': 'Recargar la página',
    "← Retour à l'accueil": '← Volver al inicio',

    // Crédits
    'Les questions de la bibliothèque viennent de bases libres, écrites par des bénévoles. Merci à elles et à eux.':
      'Las preguntas de la biblioteca proceden de bases libres, escritas por voluntarios. Gracias a todas y todos.',
    "Les questions en français viennent d'": 'Las preguntas en francés proceden de ',
    ", fournisseur de contenu libre coordonné par Philippe Bresoux. Le rédacteur de chaque quiz et le lien vers sa page d'origine figurent dans l'aperçu du quiz et dans l'éditeur.":
      ', proveedor de contenido libre coordinado por Philippe Bresoux. El autor de cada quiz y el enlace a su página de origen aparecen en la vista previa del quiz y en el editor.',
    "Pengou a adapté ces quiz : format de Pengou, classement par thème, difficulté et public, regroupement en quiz de 10 à 20 questions, retrait des anecdotes et des questions en double, dépassées ou erronées. Le texte des questions et des propositions n'est pas modifié. La liste des quiz repris, avec leur rédacteur, est dans le":
      'Pengou ha adaptado estos quiz: formato de Pengou, clasificación por tema, dificultad y público, agrupación en quiz de 10 a 20 preguntas, eliminación de las anécdotas y de las preguntas duplicadas, desactualizadas o erróneas. El texto de las preguntas y de las opciones no se ha modificado. La lista de los quiz incluidos, con su autor, está en el',
    "fichier de licence d'OpenQuizzDB": 'archivo de licencia de OpenQuizzDB',
    "Les questions en anglais viennent de l'": 'Las preguntas en inglés proceden de la ',
    ', base contributive créée par PIXELTAIL GAMES LLC et ses contributeurs.':
      ', una base colaborativa creada por PIXELTAIL GAMES LLC y sus colaboradores.',
    "Pengou a adapté ces questions : format de Pengou, classement par thème, difficulté et public, regroupement en quiz de 15 questions, retrait des questions en double. Le texte des questions et des réponses n'est pas modifié. Le détail est dans le":
      'Pengou ha adaptado estas preguntas: formato de Pengou, clasificación por tema, dificultad y público, agrupación en quiz de 15 preguntas, eliminación de las preguntas duplicadas. El texto de las preguntas y de las respuestas no se ha modificado. El detalle está en el',
    "fichier de licence de l'Open Trivia Database": 'archivo de licencia de Open Trivia Database',
    Traductions: 'Traducciones',
    "Sploot Labs traduit une partie de ces questions, avec l'aide d'une IA : celles de l'Open Trivia Database en français, celles d'OpenQuizzDB en anglais. Le type, le thème, la difficulté et la bonne réponse restent ceux de l'original. Les questions qui n'ont pas de sens une fois traduites (jeux de mots, orthographe) sont écartées. Voir les fichiers de licence des traductions":
      'Sploot Labs traduce una parte de estas preguntas, con ayuda de una IA: las de Open Trivia Database al francés, las de OpenQuizzDB al inglés. El tipo, el tema, la dificultad y la respuesta correcta siguen siendo los del original. Las preguntas que pierden sentido al traducirse (juegos de palabras, ortografía) se descartan. Consulta los archivos de licencia de las traducciones',
    'en français': 'en francés',
    'en anglais': 'en inglés',
    'Ces questions, leurs adaptations et leurs traductions sont sous licence':
      'Estas preguntas, sus adaptaciones y sus traducciones están bajo licencia',
    'Vous pouvez les copier, les modifier et les partager, y compris dans vos propres quiz, à condition de citer leur source et de partager vos modifications sous la même licence.':
      'Puedes copiarlas, modificarlas y compartirlas, también en tus propios quiz, siempre que cites su fuente y compartas tus modificaciones bajo la misma licencia.',
    "Quand vous copiez un quiz ou des questions de la bibliothèque, Pengou garde la source de chaque question et l'affiche dans l'éditeur. En fin de partie, le grand écran crédite les bases d'où viennent les questions. Le code de Pengou est sous licence Apache-2.0, qui ne s'applique pas aux questions.":
      'Cuando copias un quiz o preguntas de la biblioteca, Pengou conserva la fuente de cada pregunta y la muestra en el editor. Al final de la partida, la pantalla grande acredita las bases de las que proceden las preguntas. El código de Pengou está bajo licencia Apache-2.0, que no se aplica a las preguntas.',
  },
})
