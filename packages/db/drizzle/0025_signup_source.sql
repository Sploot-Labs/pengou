-- Provenance de l'inscription (`?from=<slug>` posé par le site vitrine sur ses liens vers /signup),
-- pour compter les inscriptions par page d'origine. Nullable : comptes existants et inscriptions
-- directes. La contrainte reprend la normalisation du serveur (slug en minuscules, 64 caractères).
ALTER TABLE "user" ADD COLUMN "signup_source" text;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_signup_source_slug" CHECK ("signup_source" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("signup_source") <= 64);
