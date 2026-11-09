-- Bibliothèque de questions : catalogue global (ni tenant_id ni RLS), lecture seule pour app_role.
-- Écrit uniquement par la synchronisation, sur la connexion privilégiée.

CREATE TYPE "library_difficulty" AS ENUM('facile', 'moyen', 'difficile');--> statement-breakpoint
CREATE TYPE "library_audience" AS ENUM('enfants', 'adultes', 'tous');--> statement-breakpoint
CREATE TYPE "library_origin" AS ENUM('builtin', 'instance');--> statement-breakpoint

CREATE TABLE "library_theme" (
  "id" text PRIMARY KEY NOT NULL,
  "label" text NOT NULL,
  "hidden" boolean DEFAULT false NOT NULL,
  "origin" "library_origin" NOT NULL
);--> statement-breakpoint

CREATE TABLE "library_question" (
  "id" text PRIMARY KEY NOT NULL,
  "type" "question_type" NOT NULL,
  "prompt" text NOT NULL,
  "prompt_search" text NOT NULL,
  "payload" jsonb NOT NULL,
  "theme_id" text NOT NULL REFERENCES "library_theme"("id"),
  "difficulty" "library_difficulty" NOT NULL,
  "language" text NOT NULL,
  "audience" "library_audience" NOT NULL,
  "time_limit" integer NOT NULL,
  "reading_time" integer NOT NULL,
  "source" jsonb NOT NULL,
  "origin" "library_origin" NOT NULL,
  "origin_file" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "library_question_criteria_idx" ON "library_question" ("theme_id", "difficulty", "language", "audience");--> statement-breakpoint

CREATE TABLE "library_quiz" (
  "id" text PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "theme_id" text NOT NULL REFERENCES "library_theme"("id"),
  "difficulty" "library_difficulty" NOT NULL,
  "language" text NOT NULL,
  "audience" "library_audience" NOT NULL,
  "source" jsonb NOT NULL,
  "origin" "library_origin" NOT NULL,
  "origin_file" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "library_quiz_question" (
  "quiz_id" text NOT NULL REFERENCES "library_quiz"("id") ON DELETE CASCADE,
  "question_id" text NOT NULL REFERENCES "library_question"("id") ON DELETE CASCADE,
  "position" integer NOT NULL,
  PRIMARY KEY ("quiz_id", "position")
);--> statement-breakpoint

-- Attribution conservée sur les copies faites dans les tenants.
ALTER TABLE "quiz" ADD COLUMN "source" jsonb;--> statement-breakpoint
ALTER TABLE "question" ADD COLUMN "source" jsonb;--> statement-breakpoint

GRANT SELECT ON "library_theme", "library_question", "library_quiz", "library_quiz_question" TO app_role;
