-- Rôle applicatif restreint : garantir l'existence (le mot de passe est posé hors migration,
-- au boot / dans le harness de test). Idempotent.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_role') THEN
    CREATE ROLE app_role LOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_role;--> statement-breakpoint

-- Tables globales (Better Auth) : app_role doit pouvoir servir les sessions ; PAS de RLS.
GRANT SELECT, INSERT, UPDATE, DELETE ON "user", "session", "account", "verification" TO app_role;--> statement-breakpoint
-- tenant/membership : accès app_role ; résolution via systemDb (pas de RLS ici — Slice 3).
GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant", "membership" TO app_role;--> statement-breakpoint

-- Tables de contenu : GRANT + RLS + policy USING/WITH CHECK fail-loud (current_setting strict).
GRANT SELECT, INSERT, UPDATE, DELETE ON "quiz", "question", "game_session", "session_player", "answer_record" TO app_role;--> statement-breakpoint

ALTER TABLE "quiz" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "quiz_tenant_isolation" ON "quiz" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
ALTER TABLE "question" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "question_tenant_isolation" ON "question" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
ALTER TABLE "game_session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "game_session_tenant_isolation" ON "game_session" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
ALTER TABLE "session_player" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "session_player_tenant_isolation" ON "session_player" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
ALTER TABLE "answer_record" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "answer_record_tenant_isolation" ON "answer_record" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
