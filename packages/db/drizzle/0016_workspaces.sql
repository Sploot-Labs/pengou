-- Slice 3 — Workspaces : slug de tenant, fin de l'unicité du nom, table invitation.

-- 1) tenant.slug : ajout nullable, backfill, puis NOT NULL + UNIQUE.
ALTER TABLE "tenant" ADD COLUMN "slug" text;--> statement-breakpoint

-- Backfill : slugify(name) URL-safe, désambiguïsé par un suffixe numérique en cas de collision
-- (row_number sur la même base). `default` → `default`.
WITH base AS (
  SELECT
    id,
    NULLIF(regexp_replace(regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), '') AS b
  FROM "tenant"
), numbered AS (
  SELECT id, b, row_number() OVER (PARTITION BY b ORDER BY id) AS rn
  FROM base
)
UPDATE "tenant" t
SET "slug" = CASE WHEN n.rn = 1 THEN n.b ELSE n.b || '-' || n.rn END
FROM numbered n
WHERE t.id = n.id AND n.b IS NOT NULL;--> statement-breakpoint

-- Filet : tout tenant sans base slugifiable (nom vide/exotique) retombe sur son id compacté.
UPDATE "tenant" SET "slug" = replace(id::text, '-', '') WHERE "slug" IS NULL;--> statement-breakpoint

ALTER TABLE "tenant" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
-- Filet applicatif : un insert qui omet slug reçoit un slug aléatoire unique (voir schema.ts).
ALTER TABLE "tenant" ALTER COLUMN "slug" SET DEFAULT replace(gen_random_uuid()::text, '-', '');--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_slug_uidx" ON "tenant" ("slug");--> statement-breakpoint

-- 2) `name` n'est plus unique globalement.
ALTER TABLE "tenant" DROP CONSTRAINT IF EXISTS "tenant_name_unique";--> statement-breakpoint

-- 3) Invitations.
CREATE TYPE "invitation_status" AS ENUM('pending', 'accepted', 'revoked');--> statement-breakpoint
CREATE TABLE "invitation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "email" text NOT NULL,
  "role" "role" DEFAULT 'member' NOT NULL,
  "token" text NOT NULL,
  "invited_by" text NOT NULL,
  "status" "invitation_status" DEFAULT 'pending' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "accepted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "invitation_token_unique" UNIQUE("token")
);--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitation_tenant_idx" ON "invitation" ("tenant_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" ("email");--> statement-breakpoint

-- app_role sert aussi la gestion des invitations (sous RLS, migration suivante).
GRANT SELECT, INSERT, UPDATE, DELETE ON "invitation" TO app_role;
