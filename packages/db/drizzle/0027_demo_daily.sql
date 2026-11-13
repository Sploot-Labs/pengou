-- Compteur quotidien des parties de démonstration : par jour (UTC) et par provenance, le nombre de
-- démonstrations lancées et de parties démarrées avec au moins un joueur. Les comptes invités étant
-- supprimés au bout de 24 heures, ce compteur garde la mesure sans aucune donnée personnelle.
-- Aucun droit pour app_role : la table n'est lue et écrite que par la connexion privilégiée.
CREATE TABLE "demo_daily" (
	"day" date NOT NULL,
	"source" text NOT NULL,
	"launched" integer DEFAULT 0 NOT NULL,
	"started" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "demo_daily_day_source_pk" PRIMARY KEY("day","source")
);
