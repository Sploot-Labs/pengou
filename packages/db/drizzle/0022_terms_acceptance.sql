-- Acceptation des conditions d'utilisation (CGU) par l'hôte. Colonnes nullables, sans valeur
-- par défaut : les comptes existants restent à null et accepteront à leur prochaine connexion.
ALTER TABLE "user" ADD COLUMN "terms_version" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "terms_accepted_at" timestamp with time zone;
