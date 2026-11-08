-- Type de question « nuage de mots » et mots retirés par l'animateur (clés normalisées
-- par question, { questionId: [clé, ...] }), conservés pour la reprise après crash et le rapport.
ALTER TYPE "public"."question_type" ADD VALUE 'wordcloud';--> statement-breakpoint
ALTER TABLE "game_session" ADD COLUMN "wordcloud_removed" jsonb DEFAULT '{}'::jsonb NOT NULL;
