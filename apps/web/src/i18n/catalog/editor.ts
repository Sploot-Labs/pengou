import { defineCatalog } from './define'

/** Éditeur de quiz (HostEditor). Les clés déjà définies ailleurs (Questions, Annuler, Archiver…) ne sont pas redites ici. */
export const editor = defineCatalog({
  en: {
    // Types de question
    QCM: 'Multiple choice',
    'QCM (4 réponses)': 'Multiple choice (4 answers)',
    'Vrai / Faux': 'True / False',

    // Contenu par défaut d'une nouvelle question
    'Nouvelle question': 'New question',
    'Réponse {n}': 'Answer {n}',
    Réponse: 'Answer',
    'Choix {n}': 'Choice {n}',

    // Validation
    'Intitulé manquant.': 'Question text missing.',
    'Durée entre 5 et 120 s.': 'Duration must be between 5 and 120 s.',
    'Le temps de lecture doit être un entier ≥ 0.': 'Reading time must be an integer ≥ 0.',
    'Chaque réponse doit avoir un libellé.': 'Every answer needs a label.',
    'Choisissez la bonne réponse.': 'Choose the correct answer.',
    'Chaque choix doit avoir un libellé.': 'Every choice needs a label.',
    'Ajoutez au moins une réponse acceptée.': 'Add at least one accepted answer.',
    'Le minimum doit être inférieur au maximum.': 'The minimum must be lower than the maximum.',
    'La valeur correcte doit être comprise entre le minimum et le maximum.':
      'The correct value must be between the minimum and the maximum.',
    'Le pas doit être positif.': 'The step must be positive.',
    'Réponse {n} : libellé manquant.': 'Answer {n}: label missing.',

    // Lancement, archivage, annonces
    'Ce quiz est archivé : restaurez-le pour lancer une partie.': 'This quiz is archived: restore it to start a game.',
    'Ajoutez au moins une question pour lancer la partie.': 'Add at least one question to start the game.',
    '{n} question à compléter avant de lancer la partie.': '{n} question left to complete before starting the game.',
    '{n} questions à compléter avant de lancer la partie.': '{n} questions left to complete before starting the game.',
    "Vos dernières modifications n'ont pas pu être enregistrées, la partie n'a pas été lancée. {error}":
      'Your latest changes could not be saved, so the game was not started. {error}',
    "La nouvelle question a été créée, mais l'ancienne n'a pas pu être supprimée : {error}. Liste resynchronisée, vous pouvez supprimer le doublon manuellement.":
      'The new question was created, but the old one could not be deleted: {error}. The list has been resynced, you can delete the duplicate manually.',
    'Quiz restauré, il peut de nouveau être lancé.': 'Quiz restored, it can be started again.',
    'Question déplacée en position {n}.': 'Question moved to position {n}.',
    'Déplacement annulé, la question est revenue en position {n}.':
      'Move canceled, the question is back in position {n}.',
    'Question ajoutée.': 'Question added.',
    'Question supprimée. Utilisez « Annuler » pour la restaurer.': 'Question deleted. Use "Undo" to restore it.',
    'Question supprimée.': 'Question deleted.',
    'Question restaurée.': 'Question restored.',

    // États de page
    'Chargement du quiz…': 'Loading quiz…',
    'Quiz introuvable.': 'Quiz not found.',

    // En-tête et méta
    'Lancer la partie': 'Start the game',
    'Éditeur de quiz': 'Quiz editor',
    'Ce quiz est archivé. Restaurez-le pour pouvoir lancer une partie.':
      'This quiz is archived. Restore it to be able to start a game.',
    Description: 'Description',
    'Une phrase pour situer le quiz.': 'A sentence introducing the quiz.',

    // Liste des questions
    'Liste des questions': 'Question list',
    "Aucune question pour l'instant, ajoutez-en une pour commencer.": 'No questions yet, add one to get started.',
    'Question sans intitulé': 'Untitled question',
    Incomplète: 'Incomplete',
    'Incomplète : {error}': 'Incomplete: {error}',
    'Réordonner la question {n}': 'Reorder question {n}',
    'Monter la question {n}': 'Move question {n} up',
    'Descendre la question {n}': 'Move question {n} down',
    'Ajouter une question': 'Add a question',

    // Formulaire de question
    'Formulaire de question': 'Question form',
    'Aucune question sélectionnée. Ajoutez une question pour commencer.':
      'No question selected. Add a question to get started.',
    'À corriger : {error}': 'To fix: {error}',
    'Intitulé de la question': 'Question text',
    'Ex. Quelle planète est surnommée la « planète rouge » ?': 'E.g. Which planet is nicknamed the "red planet"?',
    'Type de question': 'Question type',
    'Durée (secondes)': 'Duration (seconds)',
    'Temps de lecture (s)': 'Reading time (s)',
    '0 = pas de temps de lecture': '0 = no reading time',
    Choix: 'Choices',
    'Réponses (cochez la bonne réponse)': 'Answers (check the correct answer)',
    'Marquer « {label} » comme correcte': 'Mark "{label}" as correct',
    'réponse {n}': 'answer {n}',
    Correcte: 'Correct',
    'Libellé choix {n}, {shape}': 'Choice {n} label, {shape}',
    'Libellé réponse {n}, {shape}': 'Answer {n} label, {shape}',
    'Retirer le choix {n}': 'Remove choice {n}',
    'Ajouter un choix': 'Add a choice',
    'Plusieurs réponses possibles': 'Multiple answers allowed',
    'Les participants votent en direct. Pas de bonne réponse ni de points.':
      'Participants vote live. No correct answer and no points.',
    Vrai: 'True',
    Faux: 'False',
    'Réponses acceptées': 'Accepted answers',
    'Casse et accents ignorés.': 'Case and accents are ignored.',
    'Variante {n}': 'Variant {n}',
    'Ex. Reykjavik': 'E.g. Reykjavik',
    'Supprimer la variante {n}': 'Delete variant {n}',
    'Ajouter une variante': 'Add a variant',
    'Les participants proposent leurs idées en direct. Pas de bonne réponse ni de points.':
      'Participants submit their ideas live. No correct answer and no points.',
    Minimum: 'Minimum',
    Maximum: 'Maximum',
    'Pas (step)': 'Step',
    'Valeur correcte': 'Correct value',
    'Supprimer la question': 'Delete question',

    // Archivage et changement de type
    'Archiver ce quiz': 'Archive this quiz',
    "Il quittera « Mes quiz » et ne pourra plus être lancé. Ses parties passées et leurs rapports restent consultables, et vous pourrez le restaurer depuis la section « Archivés » de l'accueil.":
      'It will leave "My quizzes" and can no longer be started. Its past games and their reports stay available, and you can restore it from the "Archived" section on the home page.',
    'Changer le type de question ?': 'Change the question type?',
    'Les réponses saisies pour cette question seront effacées. Le reste (intitulé, durée, image) est conservé.':
      'The answers entered for this question will be erased. The rest (question text, duration, image) is kept.',
    'Changer de type': 'Change type',
    'Annuler#undo': 'Undo',
  },
  es: {
    QCM: 'Opción múltiple',
    'QCM (4 réponses)': 'Opción múltiple (4)',
    'Vrai / Faux': 'Verdadero / Falso',

    'Nouvelle question': 'Nueva pregunta',
    'Réponse {n}': 'Respuesta {n}',
    Réponse: 'Respuesta',
    'Choix {n}': 'Opción {n}',

    'Intitulé manquant.': 'Falta el enunciado.',
    'Durée entre 5 et 120 s.': 'La duración debe estar entre 5 y 120 s.',
    'Le temps de lecture doit être un entier ≥ 0.': 'El tiempo de lectura debe ser un número entero ≥ 0.',
    'Chaque réponse doit avoir un libellé.': 'Cada respuesta debe tener un texto.',
    'Choisissez la bonne réponse.': 'Elige la respuesta correcta.',
    'Chaque choix doit avoir un libellé.': 'Cada opción debe tener un texto.',
    'Ajoutez au moins une réponse acceptée.': 'Añade al menos una respuesta aceptada.',
    'Le minimum doit être inférieur au maximum.': 'El mínimo debe ser menor que el máximo.',
    'La valeur correcte doit être comprise entre le minimum et le maximum.':
      'El valor correcto debe estar entre el mínimo y el máximo.',
    'Le pas doit être positif.': 'El paso debe ser positivo.',
    'Réponse {n} : libellé manquant.': 'Respuesta {n}: falta el texto.',

    'Ce quiz est archivé : restaurez-le pour lancer une partie.':
      'Este quiz está archivado: restáuralo para iniciar una partida.',
    'Ajoutez au moins une question pour lancer la partie.': 'Añade al menos una pregunta para iniciar la partida.',
    '{n} question à compléter avant de lancer la partie.': '{n} pregunta por completar antes de iniciar la partida.',
    '{n} questions à compléter avant de lancer la partie.': '{n} preguntas por completar antes de iniciar la partida.',
    "Vos dernières modifications n'ont pas pu être enregistrées, la partie n'a pas été lancée. {error}":
      'No se han podido guardar tus últimos cambios, así que no se ha iniciado la partida. {error}',
    "La nouvelle question a été créée, mais l'ancienne n'a pas pu être supprimée : {error}. Liste resynchronisée, vous pouvez supprimer le doublon manuellement.":
      'Se creó la nueva pregunta, pero no se pudo eliminar la anterior: {error}. La lista se ha resincronizado, puedes eliminar el duplicado manualmente.',
    'Quiz restauré, il peut de nouveau être lancé.': 'Quiz restaurado, se puede volver a iniciar.',
    'Question déplacée en position {n}.': 'Pregunta movida a la posición {n}.',
    'Déplacement annulé, la question est revenue en position {n}.':
      'Movimiento cancelado, la pregunta ha vuelto a la posición {n}.',
    'Question ajoutée.': 'Pregunta añadida.',
    'Question supprimée. Utilisez « Annuler » pour la restaurer.':
      'Pregunta eliminada. Usa «Deshacer» para restaurarla.',
    'Question supprimée.': 'Pregunta eliminada.',
    'Question restaurée.': 'Pregunta restaurada.',

    'Chargement du quiz…': 'Cargando el quiz…',
    'Quiz introuvable.': 'Quiz no encontrado.',

    'Lancer la partie': 'Iniciar la partida',
    'Éditeur de quiz': 'Editor de quiz',
    'Ce quiz est archivé. Restaurez-le pour pouvoir lancer une partie.':
      'Este quiz está archivado. Restáuralo para poder iniciar una partida.',
    Description: 'Descripción',
    'Une phrase pour situer le quiz.': 'Una frase para presentar el quiz.',

    'Liste des questions': 'Lista de preguntas',
    "Aucune question pour l'instant, ajoutez-en une pour commencer.": 'Aún no hay preguntas, añade una para empezar.',
    'Question sans intitulé': 'Pregunta sin enunciado',
    Incomplète: 'Incompleta',
    'Incomplète : {error}': 'Incompleta: {error}',
    'Réordonner la question {n}': 'Reordenar la pregunta {n}',
    'Monter la question {n}': 'Subir la pregunta {n}',
    'Descendre la question {n}': 'Bajar la pregunta {n}',
    'Ajouter une question': 'Añadir una pregunta',

    'Formulaire de question': 'Formulario de la pregunta',
    'Aucune question sélectionnée. Ajoutez une question pour commencer.':
      'Ninguna pregunta seleccionada. Añade una pregunta para empezar.',
    'À corriger : {error}': 'Por corregir: {error}',
    'Intitulé de la question': 'Enunciado de la pregunta',
    'Ex. Quelle planète est surnommée la « planète rouge » ?': 'Ej.: ¿Qué planeta se conoce como el «planeta rojo»?',
    'Type de question': 'Tipo de pregunta',
    'Durée (secondes)': 'Duración (segundos)',
    'Temps de lecture (s)': 'Tiempo de lectura (s)',
    '0 = pas de temps de lecture': '0 = sin tiempo de lectura',
    Choix: 'Opciones',
    'Réponses (cochez la bonne réponse)': 'Respuestas (marca la correcta)',
    'Marquer « {label} » comme correcte': 'Marcar «{label}» como correcta',
    'réponse {n}': 'respuesta {n}',
    Correcte: 'Correcta',
    'Libellé choix {n}, {shape}': 'Texto de la opción {n}, {shape}',
    'Libellé réponse {n}, {shape}': 'Texto de la respuesta {n}, {shape}',
    'Retirer le choix {n}': 'Quitar la opción {n}',
    'Ajouter un choix': 'Añadir una opción',
    'Plusieurs réponses possibles': 'Varias respuestas posibles',
    'Les participants votent en direct. Pas de bonne réponse ni de points.':
      'Los participantes votan en vivo. Sin respuesta correcta ni puntos.',
    Vrai: 'Verdadero',
    Faux: 'Falso',
    'Réponses acceptées': 'Respuestas aceptadas',
    'Casse et accents ignorés.': 'Se ignoran mayúsculas y acentos.',
    'Variante {n}': 'Variante {n}',
    'Ex. Reykjavik': 'Ej.: Reikiavik',
    'Supprimer la variante {n}': 'Eliminar la variante {n}',
    'Ajouter une variante': 'Añadir una variante',
    'Les participants proposent leurs idées en direct. Pas de bonne réponse ni de points.':
      'Los participantes proponen sus ideas en vivo. Sin respuesta correcta ni puntos.',
    Minimum: 'Mínimo',
    Maximum: 'Máximo',
    'Pas (step)': 'Paso',
    'Valeur correcte': 'Valor correcto',
    'Supprimer la question': 'Eliminar la pregunta',

    'Archiver ce quiz': 'Archivar este quiz',
    "Il quittera « Mes quiz » et ne pourra plus être lancé. Ses parties passées et leurs rapports restent consultables, et vous pourrez le restaurer depuis la section « Archivés » de l'accueil.":
      'Saldrá de «Mis quiz» y ya no se podrá iniciar. Sus partidas anteriores y sus informes seguirán disponibles, y podrás restaurarlo desde la sección «Archivados» del inicio.',
    'Changer le type de question ?': '¿Cambiar el tipo de pregunta?',
    'Les réponses saisies pour cette question seront effacées. Le reste (intitulé, durée, image) est conservé.':
      'Las respuestas introducidas para esta pregunta se borrarán. Lo demás (enunciado, duración, imagen) se conserva.',
    'Changer de type': 'Cambiar de tipo',
    'Annuler#undo': 'Deshacer',
  },
})
