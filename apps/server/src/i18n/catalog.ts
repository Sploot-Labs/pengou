/**
 * Catalogue des messages du serveur. Les clés sont les messages français exacts émis par le
 * serveur et le moteur de jeu ; un message variable s'écrit avec des marqueurs (`{id}`), que
 * `localizeMessage` retrouve dans le message réel. Le garde-fou `catalog.test.ts` vérifie que
 * chaque message des sources y figure.
 *
 * Ton : l'anglais dit « you », l'espagnol tutoie. Les messages techniques de la passerelle de jeu
 * (minuscule initiale, sans point) gardent leur forme courte.
 */

const en = {
  // Session, droits, origine
  'Non authentifié.': 'Not authenticated.',
  'Accès refusé à ce tenant.': 'Access denied to this workspace.',
  'Accès refusé à ce workspace.': 'Access denied to this workspace.',
  'Identifiant de workspace invalide.': 'Invalid workspace ID.',
  'Origine non autorisée.': 'Origin not allowed.',
  'Créez un compte gratuit pour utiliser cette fonction.': 'Create a free account to use this feature.',
  "Cette fonctionnalité n'est pas disponible sur ce serveur.": 'This feature is not available on this server.',
  'not found': 'not found',

  // Conditions d'utilisation
  "Les conditions d'utilisation ont changé. Acceptez-les pour continuer.":
    'The terms of use have changed. Accept them to continue.',
  "Aucune condition d'utilisation à accepter sur cette instance.":
    'There are no terms of use to accept on this instance.',
  "Les conditions d'utilisation ont encore changé. Rechargez la page pour lire la dernière version.":
    'The terms of use have changed again. Reload the page to read the latest version.',
  'Confirmez que vous avez 15 ans ou plus pour créer un compte.':
    'Confirm that you are 15 or older to create an account.',
  "Les conditions d'utilisation ont changé. Rechargez la page pour lire et accepter la nouvelle version.":
    'The terms of use have changed. Reload the page to read and accept the new version.',
  "Acceptez les conditions d'utilisation pour créer un compte.": 'Accept the terms of use to create an account.',

  // Compte et authentification (Better Auth, traduit par code)
  'E-mail ou mot de passe incorrect.': 'Incorrect email or password.',
  'E-mail invalide.': 'Invalid email address.',
  'Mot de passe invalide.': 'Invalid password.',
  'Le mot de passe est trop court.': 'The password is too short.',
  'Le mot de passe est trop long.': 'The password is too long.',
  'Un compte existe déjà avec cette adresse e-mail.': 'An account already exists with this email address.',
  'Confirmez votre adresse e-mail avant de vous connecter.': 'Confirm your email address before signing in.',
  "Ce lien n'est plus valable. Demandez-en un nouveau.": 'This link is no longer valid. Request a new one.',
  'Compte introuvable.': 'Account not found.',
  'La création du compte a échoué. Réessayez.': 'Account creation failed. Try again.',
  'La connexion a échoué. Réessayez.': 'Sign-in failed. Try again.',
  'Cette adresse e-mail est déjà confirmée.': 'This email address is already confirmed.',
  'Cette adresse e-mail ne correspond pas à votre compte.': 'This email address does not match your account.',
  "La confirmation d'adresse e-mail n'est pas disponible sur ce serveur.":
    'Email address confirmation is not available on this server.',
  "La réinitialisation du mot de passe n'est pas disponible sur ce serveur.":
    'Password reset is not available on this server.',
  "La connexion par e-mail n'est pas disponible sur ce serveur.": 'Email sign-in is not available on this server.',
  "L'inscription par e-mail n'est pas disponible sur ce serveur.": 'Email sign-up is not available on this server.',
  'Adresse de redirection non autorisée.': 'Redirect address not allowed.',
  'La demande est invalide.': 'The request is invalid.',
  'Votre session a expiré. Reconnectez-vous.': 'Your session has expired. Please sign in again.',
  'Trop de tentatives. Patientez un instant puis réessayez.': 'Too many attempts. Wait a moment and try again.',
  'Les adresses e-mail jetables ne sont pas acceptées.': 'Disposable email addresses are not accepted.',
  "Ce domaine ne semble pas pouvoir recevoir d'e-mails. Vérifiez l'adresse.":
    'This domain does not seem able to receive emails. Check the address.',

  // Partie de démonstration
  "La démonstration n'est pas disponible sur cette instance.": 'The demo is not available on this instance.',
  'Vous êtes déjà connecté : lancez un quiz depuis votre espace.':
    'You are already signed in: start a quiz from your workspace.',
  'Confirmez que vous avez 15 ans ou plus pour lancer la démonstration.':
    'Confirm that you are 15 or older to start the demo.',
  "Acceptez les conditions d'utilisation pour lancer la démonstration.": 'Accept the terms of use to start the demo.',
  'La démonstration est très demandée en ce moment. Créez un compte gratuit pour lancer votre quiz tout de suite.':
    'The demo is in high demand right now. Create a free account to start your quiz right away.',
  'Trop de démonstrations lancées depuis votre réseau. Réessayez dans une heure, ou créez un compte gratuit.':
    'Too many demos started from your network. Try again in an hour, or create a free account.',
  'Une démonstration est déjà en cours.': 'A demo is already in progress.',
  'La démonstration est très demandée en ce moment.': 'The demo is in high demand right now.',

  // Invitations et membres
  'Invitation introuvable.': 'Invitation not found.',
  'Cette invitation a déjà été utilisée ou révoquée.': 'This invitation has already been used or revoked.',
  'Cette invitation a expiré.': 'This invitation has expired.',
  'Vous êtes déjà membre de ce workspace.': 'You are already a member of this workspace.',
  "Cette invitation n'est plus valable.": 'This invitation is no longer valid.',
  'Invitation invalide.': 'Invalid invitation.',
  "Trop d'invitations envoyées en une heure. Réessayez plus tard.":
    'Too many invitations sent in one hour. Try again later.',
  'Invitation en attente introuvable.': 'Pending invitation not found.',
  'Rôle invalide (owner, admin ou member attendu).': 'Invalid role (owner, admin or member expected).',
  'Membre introuvable.': 'Member not found.',
  'Seul un owner peut gérer les rôles owner.': 'Only an owner can manage owner roles.',
  'Impossible de rétrograder le dernier owner du workspace.': 'The last owner of the workspace cannot be demoted.',
  'Seul un owner peut retirer un owner.': 'Only an owner can remove an owner.',
  'Impossible de retirer le dernier owner du workspace.': 'The last owner of the workspace cannot be removed.',
  'La création de workspace est réservée au mode multi.': 'Creating a workspace is only available in multi mode.',
  'Le nom du workspace est requis.': 'The workspace name is required.',
  'Le nom est trop long ({max} caractères max).': 'The name is too long ({max} characters max).',

  // Quiz, questions, images
  'Le titre est requis.': 'The title is required.',
  'Le titre est trop long ({max} caractères max).': 'The title is too long ({max} characters max).',
  'Le titre ne peut pas être vide.': 'The title cannot be empty.',
  'La description est trop longue ({max} caractères max).': 'The description is too long ({max} characters max).',
  'La description doit être une chaîne ou null.': 'The description must be a string or null.',
  'La couverture doit être une chaîne ou null.': 'The cover must be a string or null.',
  'Couverture invalide (URL http(s) ou référence relative attendue).':
    'Invalid cover (http(s) URL or relative reference expected).',
  'Quiz introuvable.': 'Quiz not found.',
  "Confirmez votre adresse e-mail pour créer d'autres quiz.": 'Confirm your email address to create more quizzes.',
  'Le type de question est invalide.': 'The question type is invalid.',
  "L'énoncé (prompt) est requis.": 'The question text (prompt) is required.',
  "L'énoncé (prompt) ne peut pas être vide.": 'The question text (prompt) cannot be empty.',
  "L'énoncé est trop long ({max} caractères max).": 'The question text is too long ({max} characters max).',
  'timeLimit doit être un entier positif.': 'timeLimit must be a positive integer.',
  'readingTime doit être un entier positif ou nul.': 'readingTime must be a non-negative integer.',
  'Le payload est invalide pour ce type de question.': 'The payload is invalid for this question type.',
  'media doit être une chaîne ou null.': 'media must be a string or null.',
  'media invalide (image envoyée attendue).': 'invalid media (uploaded image expected).',
  'mediaAlt doit être une chaîne ou null.': 'mediaAlt must be a string or null.',
  'Le texte alternatif est trop long ({max} caractères max).': 'The alt text is too long ({max} characters max).',
  'Question ou quiz introuvable.': 'Question or quiz not found.',
  'orderedIds doit être un tableau de chaînes.': 'orderedIds must be an array of strings.',
  'Quiz introuvable ou orderedIds invalide.': 'Quiz not found or invalid orderedIds.',
  'Aucun fichier reçu.': 'No file received.',
  'Image trop lourde (2 Mo max).': 'Image too large (2 MB max).',
  'Format non pris en charge (PNG, JPEG, WebP ou GIF).': 'Unsupported format (PNG, JPEG, WebP or GIF).',
  "Confirmez votre adresse e-mail pour envoyer d'autres images.": 'Confirm your email address to upload more images.',
  'Espace images du workspace plein ({max} Mo max).': 'Workspace image storage is full ({max} MB max).',

  // Bibliothèque
  'Critère « {critere} » invalide.': 'Invalid filter "{critere}".',
  'Difficulté inconnue.': 'Unknown difficulty.',
  'Public inconnu.': 'Unknown audience.',
  'Recherche invalide.': 'Invalid search.',
  'Quiz introuvable dans la bibliothèque.': 'Quiz not found in the library.',
  'Décalage invalide.': 'Invalid offset.',
  'Limite invalide.': 'Invalid limit.',
  'Critères invalides.': 'Invalid filters.',
  'Le nombre de questions doit être un entier de 1 à {max}.':
    'The number of questions must be a whole number from 1 to {max}.',
  'Les questions à exclure doivent être au plus {max} identifiants.': 'At most {max} question IDs can be excluded.',
  'Choisissez au moins une question.': 'Choose at least one question.',
  'Trop de questions ({max} max).': 'Too many questions ({max} max).',
  'Une même question ne peut pas être choisie deux fois.': 'The same question cannot be chosen twice.',
  'Question introuvable dans la bibliothèque.': 'Question not found in the library.',

  // Rapports
  'Partie introuvable.': 'Game not found.',

  // Passerelle de jeu (acquittements Socket.IO)
  'authentification requise': 'authentication required',
  'Ce quiz est archivé : restaurez-le pour lancer une partie.': 'This quiz is archived: restore it to start a game.',
  'quiz introuvable': 'quiz not found',
  'création de la session impossible': 'unable to create the game',
  "votre session a expiré ou vous n'êtes plus membre de cet espace":
    'your session has expired or you are no longer a member of this workspace',
  "action réservée à l'hôte de la session": 'action reserved for the game host',
  'session introuvable': 'game not found',
  'host:skip : aucune question active (session encore en lobby)':
    'host:skip: no active question (game still in the lobby)',
  'host:skip : aucune question active (partie terminée, podium)': 'host:skip: no active question (game over, podium)',
  'cette connexion est déjà utilisée par un hôte ou un écran': 'this connection is already used by a host or a screen',
  'trop de requêtes (throttle)': 'too many requests (throttle)',
  'quizId requis': 'quizId required',
  'host:relaunch : relance possible seulement en fin de partie':
    'host:relaunch: relaunch is only possible at the end of the game',
  'sessionId requis': 'sessionId required',
  "cet utilisateur n'est pas l'hôte de cette session": 'this user is not the host of this game',
  'host:reveal : aucune question active (session encore en lobby)':
    'host:reveal: no active question (game still in the lobby)',
  'mot requis': 'word required',
  'mot trop long': 'word too long',
  'mot invalide': 'invalid word',
  'playerId requis': 'playerId required',
  'pin requis': 'PIN required',
  'nickname requis': 'nickname required',
  'nickname trop long (32 caractères max)': 'nickname too long (32 characters max)',
  'PIN invalide': 'Invalid PIN',
  'La partie est complète.': 'The game is full.',
  'joueur non rattaché à une session': 'player not attached to a game',
  'joinToken requis': 'joinToken required',
  'PIN ou jeton invalide': 'Invalid PIN or token',
  'trop de tentatives, réessayez dans quelques minutes': 'too many attempts, try again in a few minutes',
  'displayToken requis': 'displayToken required',
  'displayToken invalide ou déjà utilisé': 'invalid or already used displayToken',
  'displayToken invalide': 'invalid displayToken',
  'recordAnswer: session {id} absente du cache': 'recordAnswer: game {id} missing from the cache',

  // Moteur de jeu
  'session introuvable : {id}': 'game not found: {id}',
  'impossible de générer un PIN unique': 'unable to generate a unique PIN',
  'startQuestion : plus de questions disponibles': 'startQuestion: no more questions available',
  'hors phase question': 'outside the question phase',
  'joueur inconnu': 'unknown player',
  'aucune question active': 'no active question',
  'réponse déjà soumise pour cette question': 'answer already submitted for this question',
  'question non démarrée correctement (questionStartedAt manquant)':
    'question not started correctly (questionStartedAt missing)',
  'réponse invalide pour ce type de question': 'invalid answer for this question type',
  'mot déjà envoyé': 'word already sent',
  'limite de {max} mots atteinte': 'limit of {max} words reached',
  'retrait impossible hors question nuage de mots': 'removal is only possible during a word cloud question',
  'exclusion impossible au podium': 'players cannot be kicked at the podium',
  'joueur exclu de la partie': 'player kicked from the game',
  'erreur inconnue': 'unknown error',
} as const satisfies Record<string, string>

export type ServerKey = keyof typeof en

const es: Record<ServerKey, string> = {
  'Non authentifié.': 'No autenticado.',
  'Accès refusé à ce tenant.': 'Acceso denegado a este espacio de trabajo.',
  'Accès refusé à ce workspace.': 'Acceso denegado a este espacio de trabajo.',
  'Identifiant de workspace invalide.': 'Identificador de espacio de trabajo no válido.',
  'Origine non autorisée.': 'Origen no autorizado.',
  'Créez un compte gratuit pour utiliser cette fonction.': 'Crea una cuenta gratuita para usar esta función.',
  "Cette fonctionnalité n'est pas disponible sur ce serveur.": 'Esta función no está disponible en este servidor.',
  'not found': 'no encontrado',

  "Les conditions d'utilisation ont changé. Acceptez-les pour continuer.":
    'Las condiciones de uso han cambiado. Acéptalas para continuar.',
  "Aucune condition d'utilisation à accepter sur cette instance.":
    'No hay condiciones de uso que aceptar en esta instancia.',
  "Les conditions d'utilisation ont encore changé. Rechargez la page pour lire la dernière version.":
    'Las condiciones de uso han vuelto a cambiar. Recarga la página para leer la última versión.',
  'Confirmez que vous avez 15 ans ou plus pour créer un compte.':
    'Confirma que tienes 15 años o más para crear una cuenta.',
  "Les conditions d'utilisation ont changé. Rechargez la page pour lire et accepter la nouvelle version.":
    'Las condiciones de uso han cambiado. Recarga la página para leer y aceptar la nueva versión.',
  "Acceptez les conditions d'utilisation pour créer un compte.": 'Acepta las condiciones de uso para crear una cuenta.',

  'E-mail ou mot de passe incorrect.': 'Correo electrónico o contraseña incorrectos.',
  'E-mail invalide.': 'Correo electrónico no válido.',
  'Mot de passe invalide.': 'Contraseña no válida.',
  'Le mot de passe est trop court.': 'La contraseña es demasiado corta.',
  'Le mot de passe est trop long.': 'La contraseña es demasiado larga.',
  'Un compte existe déjà avec cette adresse e-mail.': 'Ya existe una cuenta con este correo electrónico.',
  'Confirmez votre adresse e-mail avant de vous connecter.': 'Confirma tu correo electrónico antes de iniciar sesión.',
  "Ce lien n'est plus valable. Demandez-en un nouveau.": 'Este enlace ya no es válido. Solicita uno nuevo.',
  'Compte introuvable.': 'Cuenta no encontrada.',
  'La création du compte a échoué. Réessayez.': 'No se pudo crear la cuenta. Inténtalo de nuevo.',
  'La connexion a échoué. Réessayez.': 'No se pudo iniciar sesión. Inténtalo de nuevo.',
  'Cette adresse e-mail est déjà confirmée.': 'Este correo electrónico ya está confirmado.',
  'Cette adresse e-mail ne correspond pas à votre compte.': 'Este correo electrónico no coincide con tu cuenta.',
  "La confirmation d'adresse e-mail n'est pas disponible sur ce serveur.":
    'La confirmación del correo electrónico no está disponible en este servidor.',
  "La réinitialisation du mot de passe n'est pas disponible sur ce serveur.":
    'El restablecimiento de contraseña no está disponible en este servidor.',
  "La connexion par e-mail n'est pas disponible sur ce serveur.":
    'El inicio de sesión por correo electrónico no está disponible en este servidor.',
  "L'inscription par e-mail n'est pas disponible sur ce serveur.":
    'El registro por correo electrónico no está disponible en este servidor.',
  'Adresse de redirection non autorisée.': 'Dirección de redirección no autorizada.',
  'La demande est invalide.': 'La solicitud no es válida.',
  'Votre session a expiré. Reconnectez-vous.': 'Tu sesión ha caducado. Vuelve a iniciar sesión.',
  'Trop de tentatives. Patientez un instant puis réessayez.':
    'Demasiados intentos. Espera un momento y vuelve a intentarlo.',
  'Les adresses e-mail jetables ne sont pas acceptées.': 'No se aceptan correos electrónicos desechables.',
  "Ce domaine ne semble pas pouvoir recevoir d'e-mails. Vérifiez l'adresse.":
    'Este dominio no parece poder recibir correos electrónicos. Revisa la dirección.',

  "La démonstration n'est pas disponible sur cette instance.": 'La demostración no está disponible en esta instancia.',
  'Vous êtes déjà connecté : lancez un quiz depuis votre espace.':
    'Ya has iniciado sesión: inicia un quiz desde tu espacio de trabajo.',
  'Confirmez que vous avez 15 ans ou plus pour lancer la démonstration.':
    'Confirma que tienes 15 años o más para iniciar la demostración.',
  "Acceptez les conditions d'utilisation pour lancer la démonstration.":
    'Acepta las condiciones de uso para iniciar la demostración.',
  'La démonstration est très demandée en ce moment. Créez un compte gratuit pour lancer votre quiz tout de suite.':
    'La demostración tiene mucha demanda en este momento. Crea una cuenta gratuita para iniciar tu quiz ahora mismo.',
  'Trop de démonstrations lancées depuis votre réseau. Réessayez dans une heure, ou créez un compte gratuit.':
    'Demasiadas demostraciones iniciadas desde tu red. Inténtalo de nuevo dentro de una hora o crea una cuenta gratuita.',
  'Une démonstration est déjà en cours.': 'Ya hay una demostración en curso.',
  'La démonstration est très demandée en ce moment.': 'La demostración tiene mucha demanda en este momento.',

  'Invitation introuvable.': 'Invitación no encontrada.',
  'Cette invitation a déjà été utilisée ou révoquée.': 'Esta invitación ya se usó o fue revocada.',
  'Cette invitation a expiré.': 'Esta invitación ha caducado.',
  'Vous êtes déjà membre de ce workspace.': 'Ya eres miembro de este espacio de trabajo.',
  "Cette invitation n'est plus valable.": 'Esta invitación ya no es válida.',
  'Invitation invalide.': 'Invitación no válida.',
  "Trop d'invitations envoyées en une heure. Réessayez plus tard.":
    'Demasiadas invitaciones enviadas en una hora. Inténtalo de nuevo más tarde.',
  'Invitation en attente introuvable.': 'Invitación pendiente no encontrada.',
  'Rôle invalide (owner, admin ou member attendu).': 'Rol no válido (se espera owner, admin o member).',
  'Membre introuvable.': 'Miembro no encontrado.',
  'Seul un owner peut gérer les rôles owner.': 'Solo un owner puede gestionar los roles owner.',
  'Impossible de rétrograder le dernier owner du workspace.':
    'No se puede degradar al último owner del espacio de trabajo.',
  'Seul un owner peut retirer un owner.': 'Solo un owner puede retirar a un owner.',
  'Impossible de retirer le dernier owner du workspace.': 'No se puede retirar al último owner del espacio de trabajo.',
  'La création de workspace est réservée au mode multi.':
    'La creación de espacios de trabajo solo está disponible en modo multi.',
  'Le nom du workspace est requis.': 'El nombre del espacio de trabajo es obligatorio.',
  'Le nom est trop long ({max} caractères max).': 'El nombre es demasiado largo ({max} caracteres máx.).',

  'Le titre est requis.': 'El título es obligatorio.',
  'Le titre est trop long ({max} caractères max).': 'El título es demasiado largo ({max} caracteres máx.).',
  'Le titre ne peut pas être vide.': 'El título no puede estar vacío.',
  'La description est trop longue ({max} caractères max).':
    'La descripción es demasiado larga ({max} caracteres máx.).',
  'La description doit être une chaîne ou null.': 'La descripción debe ser una cadena o null.',
  'La couverture doit être une chaîne ou null.': 'La portada debe ser una cadena o null.',
  'Couverture invalide (URL http(s) ou référence relative attendue).':
    'Portada no válida (se espera una URL http(s) o una referencia relativa).',
  'Quiz introuvable.': 'Quiz no encontrado.',
  "Confirmez votre adresse e-mail pour créer d'autres quiz.": 'Confirma tu correo electrónico para crear más quiz.',
  'Le type de question est invalide.': 'El tipo de pregunta no es válido.',
  "L'énoncé (prompt) est requis.": 'El enunciado (prompt) es obligatorio.',
  "L'énoncé (prompt) ne peut pas être vide.": 'El enunciado (prompt) no puede estar vacío.',
  "L'énoncé est trop long ({max} caractères max).": 'El enunciado es demasiado largo ({max} caracteres máx.).',
  'timeLimit doit être un entier positif.': 'timeLimit debe ser un entero positivo.',
  'readingTime doit être un entier positif ou nul.': 'readingTime debe ser un entero positivo o cero.',
  'Le payload est invalide pour ce type de question.': 'El payload no es válido para este tipo de pregunta.',
  'media doit être une chaîne ou null.': 'media debe ser una cadena o null.',
  'media invalide (image envoyée attendue).': 'media no válido (se espera una imagen subida).',
  'mediaAlt doit être une chaîne ou null.': 'mediaAlt debe ser una cadena o null.',
  'Le texte alternatif est trop long ({max} caractères max).':
    'El texto alternativo es demasiado largo ({max} caracteres máx.).',
  'Question ou quiz introuvable.': 'Pregunta o quiz no encontrado.',
  'orderedIds doit être un tableau de chaînes.': 'orderedIds debe ser una lista de cadenas.',
  'Quiz introuvable ou orderedIds invalide.': 'Quiz no encontrado u orderedIds no válido.',
  'Aucun fichier reçu.': 'No se recibió ningún archivo.',
  'Image trop lourde (2 Mo max).': 'Imagen demasiado pesada (2 MB máx.).',
  'Format non pris en charge (PNG, JPEG, WebP ou GIF).': 'Formato no compatible (PNG, JPEG, WebP o GIF).',
  "Confirmez votre adresse e-mail pour envoyer d'autres images.":
    'Confirma tu correo electrónico para subir más imágenes.',
  'Espace images du workspace plein ({max} Mo max).':
    'El espacio de imágenes del espacio de trabajo está lleno ({max} MB máx.).',

  'Critère « {critere} » invalide.': 'Criterio «{critere}» no válido.',
  'Difficulté inconnue.': 'Dificultad desconocida.',
  'Public inconnu.': 'Público desconocido.',
  'Recherche invalide.': 'Búsqueda no válida.',
  'Quiz introuvable dans la bibliothèque.': 'Quiz no encontrado en la biblioteca.',
  'Décalage invalide.': 'Desplazamiento no válido.',
  'Limite invalide.': 'Límite no válido.',
  'Critères invalides.': 'Criterios no válidos.',
  'Le nombre de questions doit être un entier de 1 à {max}.':
    'El número de preguntas debe ser un entero entre 1 y {max}.',
  'Les questions à exclure doivent être au plus {max} identifiants.':
    'Se pueden excluir como máximo {max} identificadores de preguntas.',
  'Choisissez au moins une question.': 'Elige al menos una pregunta.',
  'Trop de questions ({max} max).': 'Demasiadas preguntas ({max} máx.).',
  'Une même question ne peut pas être choisie deux fois.': 'No se puede elegir la misma pregunta dos veces.',
  'Question introuvable dans la bibliothèque.': 'Pregunta no encontrada en la biblioteca.',

  'Partie introuvable.': 'Partida no encontrada.',

  'authentification requise': 'autenticación requerida',
  'Ce quiz est archivé : restaurez-le pour lancer une partie.':
    'Este quiz está archivado: restáuralo para iniciar una partida.',
  'quiz introuvable': 'quiz no encontrado',
  'création de la session impossible': 'no se pudo crear la partida',
  "votre session a expiré ou vous n'êtes plus membre de cet espace":
    'tu sesión ha caducado o ya no eres miembro de este espacio de trabajo',
  "action réservée à l'hôte de la session": 'acción reservada al anfitrión de la partida',
  'session introuvable': 'partida no encontrada',
  'host:skip : aucune question active (session encore en lobby)':
    'host:skip: ninguna pregunta activa (la partida sigue en la sala de espera)',
  'host:skip : aucune question active (partie terminée, podium)':
    'host:skip: ninguna pregunta activa (partida terminada, podio)',
  'cette connexion est déjà utilisée par un hôte ou un écran': 'esta conexión ya la usa un anfitrión o una pantalla',
  'trop de requêtes (throttle)': 'demasiadas solicitudes (throttle)',
  'quizId requis': 'quizId requerido',
  'host:relaunch : relance possible seulement en fin de partie':
    'host:relaunch: solo se puede relanzar al final de la partida',
  'sessionId requis': 'sessionId requerido',
  "cet utilisateur n'est pas l'hôte de cette session": 'este usuario no es el anfitrión de esta partida',
  'host:reveal : aucune question active (session encore en lobby)':
    'host:reveal: ninguna pregunta activa (la partida sigue en la sala de espera)',
  'mot requis': 'palabra requerida',
  'mot trop long': 'palabra demasiado larga',
  'mot invalide': 'palabra no válida',
  'playerId requis': 'playerId requerido',
  'pin requis': 'PIN requerido',
  'nickname requis': 'apodo requerido',
  'nickname trop long (32 caractères max)': 'apodo demasiado largo (32 caracteres máx.)',
  'PIN invalide': 'PIN no válido',
  'La partie est complète.': 'La partida está completa.',
  'joueur non rattaché à une session': 'jugador no vinculado a una partida',
  'joinToken requis': 'joinToken requerido',
  'PIN ou jeton invalide': 'PIN o token no válido',
  'trop de tentatives, réessayez dans quelques minutes': 'demasiados intentos, inténtalo de nuevo en unos minutos',
  'displayToken requis': 'displayToken requerido',
  'displayToken invalide ou déjà utilisé': 'displayToken no válido o ya usado',
  'displayToken invalide': 'displayToken no válido',
  'recordAnswer: session {id} absente du cache': 'recordAnswer: partida {id} ausente de la caché',

  'session introuvable : {id}': 'partida no encontrada: {id}',
  'impossible de générer un PIN unique': 'no se pudo generar un PIN único',
  'startQuestion : plus de questions disponibles': 'startQuestion: no quedan preguntas disponibles',
  'hors phase question': 'fuera de la fase de pregunta',
  'joueur inconnu': 'jugador desconocido',
  'aucune question active': 'ninguna pregunta activa',
  'réponse déjà soumise pour cette question': 'respuesta ya enviada para esta pregunta',
  'question non démarrée correctement (questionStartedAt manquant)':
    'pregunta no iniciada correctamente (falta questionStartedAt)',
  'réponse invalide pour ce type de question': 'respuesta no válida para este tipo de pregunta',
  'mot déjà envoyé': 'palabra ya enviada',
  'limite de {max} mots atteinte': 'límite de {max} palabras alcanzado',
  'retrait impossible hors question nuage de mots': 'solo se puede retirar durante una pregunta de nube de palabras',
  'exclusion impossible au podium': 'no se puede expulsar a jugadores en el podio',
  'joueur exclu de la partie': 'jugador expulsado de la partida',
  'erreur inconnue': 'error desconocido',
}

export const serverCatalog: { en: Record<ServerKey, string>; es: Record<ServerKey, string> } = { en, es }

/**
 * Messages des réponses de Better Auth (`{ message, code }`), traduits par leur code. Seuls les
 * codes que les écrans du web peuvent recevoir (inscription, connexion, mot de passe oublié,
 * réinitialisation, confirmation d'adresse, déconnexion) y figurent ; un code inconnu garde son
 * message. `TOO_MANY_REQUESTS` n'est pas un code de Better Auth : son limiteur répond sans code,
 * voir `localizeAuthError`.
 */
export const authErrorKeys: Readonly<Record<string, ServerKey>> = {
  INVALID_EMAIL_OR_PASSWORD: 'E-mail ou mot de passe incorrect.',
  INVALID_EMAIL: 'E-mail invalide.',
  INVALID_PASSWORD: 'Mot de passe invalide.',
  PASSWORD_TOO_SHORT: 'Le mot de passe est trop court.',
  PASSWORD_TOO_LONG: 'Le mot de passe est trop long.',
  USER_ALREADY_EXISTS: 'Un compte existe déjà avec cette adresse e-mail.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'Un compte existe déjà avec cette adresse e-mail.',
  EMAIL_NOT_VERIFIED: 'Confirmez votre adresse e-mail avant de vous connecter.',
  INVALID_TOKEN: "Ce lien n'est plus valable. Demandez-en un nouveau.",
  TOKEN_EXPIRED: "Ce lien n'est plus valable. Demandez-en un nouveau.",
  USER_NOT_FOUND: 'Compte introuvable.',
  USER_EMAIL_NOT_FOUND: 'Compte introuvable.',
  CREDENTIAL_ACCOUNT_NOT_FOUND: 'Compte introuvable.',
  INVALID_USER: 'Compte introuvable.',
  FAILED_TO_CREATE_USER: 'La création du compte a échoué. Réessayez.',
  FAILED_TO_CREATE_SESSION: 'La connexion a échoué. Réessayez.',
  FAILED_TO_GET_SESSION: 'La connexion a échoué. Réessayez.',
  EMAIL_ALREADY_VERIFIED: 'Cette adresse e-mail est déjà confirmée.',
  EMAIL_MISMATCH: 'Cette adresse e-mail ne correspond pas à votre compte.',
  VERIFICATION_EMAIL_NOT_ENABLED: "La confirmation d'adresse e-mail n'est pas disponible sur ce serveur.",
  RESET_PASSWORD_DISABLED: "La réinitialisation du mot de passe n'est pas disponible sur ce serveur.",
  EMAIL_PASSWORD_DISABLED: "La connexion par e-mail n'est pas disponible sur ce serveur.",
  EMAIL_PASSWORD_SIGN_UP_DISABLED: "L'inscription par e-mail n'est pas disponible sur ce serveur.",
  INVALID_ORIGIN: 'Origine non autorisée.',
  MISSING_OR_NULL_ORIGIN: 'Origine non autorisée.',
  CROSS_SITE_NAVIGATION_LOGIN_BLOCKED: 'Origine non autorisée.',
  INVALID_CALLBACK_URL: 'Adresse de redirection non autorisée.',
  INVALID_REDIRECT_URL: 'Adresse de redirection non autorisée.',
  INVALID_ERROR_CALLBACK_URL: 'Adresse de redirection non autorisée.',
  INVALID_NEW_USER_CALLBACK_URL: 'Adresse de redirection non autorisée.',
  CALLBACK_URL_REQUIRED: 'Adresse de redirection non autorisée.',
  VALIDATION_ERROR: 'La demande est invalide.',
  MISSING_FIELD: 'La demande est invalide.',
  FIELD_NOT_ALLOWED: 'La demande est invalide.',
  BODY_MUST_BE_AN_OBJECT: 'La demande est invalide.',
  SESSION_EXPIRED: 'Votre session a expiré. Reconnectez-vous.',
  TOO_MANY_REQUESTS: 'Trop de tentatives. Patientez un instant puis réessayez.',
}

/**
 * Messages qui n'apparaissent pas sous forme de littéral repérable par le garde-fou : ternaires
 * (routes/demo.ts, packages/auth/src/terms.ts), `super(…)` de `PlayerKickedError`, retours de
 * `mediaQuotaRefusal`. Le test vérifie qu'ils restent des clés du catalogue.
 */
export const INDIRECT_MESSAGES: readonly ServerKey[] = [
  "Acceptez les conditions d'utilisation pour lancer la démonstration.",
  "Les conditions d'utilisation ont changé. Rechargez la page pour lire et accepter la nouvelle version.",
  'Confirmez que vous avez 15 ans ou plus pour créer un compte.',
  "Acceptez les conditions d'utilisation pour créer un compte.",
  'joueur exclu de la partie',
  "Confirmez votre adresse e-mail pour envoyer d'autres images.",
  'Espace images du workspace plein ({max} Mo max).',
  // Repli de `message()` (game-gateway.ts) pour une exception qui n'est pas une Error.
  'erreur inconnue',
]

const csvEn = {
  'Partie {pin} — {title}': 'Game {pin}: {title}',
  Joueurs: 'Players',
  Pseudo: 'Nickname',
  'Score total': 'Total score',
  'Réponses correctes': 'Correct answers',
  'Réponses données': 'Answers given',
  Questions: 'Questions',
  Énoncé: 'Question',
  'Temps moyen (ms)': 'Average time (ms)',
  'Nuage de mots : {prompt} ({participants}, {words})': 'Word cloud: {prompt} ({participants}, {words})',
  'Sondage : {prompt} ({participants})': 'Poll: {prompt} ({participants})',
  '{count} participant': '{count} participant',
  '{count} participants': '{count} participants',
  '{count} mot': '{count} word',
  '{count} mots': '{count} words',
  Mot: 'Word',
  Occurrences: 'Occurrences',
  Choix: 'Choice',
  Votes: 'Votes',
  Pourcentage: 'Percentage',
} as const satisfies Record<string, string>

export type CsvKey = keyof typeof csvEn

const csvEs: Record<CsvKey, string> = {
  'Partie {pin} — {title}': 'Partida {pin}: {title}',
  Joueurs: 'Jugadores',
  Pseudo: 'Apodo',
  'Score total': 'Puntuación total',
  'Réponses correctes': 'Respuestas correctas',
  'Réponses données': 'Respuestas dadas',
  Questions: 'Preguntas',
  Énoncé: 'Enunciado',
  'Temps moyen (ms)': 'Tiempo medio (ms)',
  'Nuage de mots : {prompt} ({participants}, {words})': 'Nube de palabras: {prompt} ({participants}, {words})',
  'Sondage : {prompt} ({participants})': 'Encuesta: {prompt} ({participants})',
  '{count} participant': '{count} participante',
  '{count} participants': '{count} participantes',
  '{count} mot': '{count} palabra',
  '{count} mots': '{count} palabras',
  Mot: 'Palabra',
  Occurrences: 'Apariciones',
  Choix: 'Opción',
  Votes: 'Votos',
  Pourcentage: 'Porcentaje',
}

/** Libellés du rapport CSV d'une partie, à part : ce ne sont pas des messages d'erreur. */
export const csvCatalog: { en: Record<CsvKey, string>; es: Record<CsvKey, string> } = { en: csvEn, es: csvEs }
