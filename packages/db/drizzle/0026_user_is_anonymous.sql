-- Hôte invité de la partie de démonstration (plugin `anonymous` de Better Auth) : un compte sans
-- adresse réelle, créé par POST /api/demo et supprimé au bout de 24 heures.
ALTER TABLE "user" ADD COLUMN "is_anonymous" boolean DEFAULT false NOT NULL;
