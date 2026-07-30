-- Slice 3 — RLS sur tenant/membership/invitation.
--
-- Motif identique au contenu (Slice 2, 0015) : policies USING/WITH CHECK fail-loud clefées sur le
-- GUC `app.tenant_id` (current_setting strict → lève si le contexte n'est pas posé). Les endpoints
-- de GESTION (list/patch/remove membres, CRUD invitations) tournent sur appDb dans withTenantTx,
-- donc SOUS ces policies. Les opérations INTRINSÈQUEMENT pré-contexte — résolution du tenant
-- (resolveTenantContext), « mes workspaces » (listUserWorkspaces), création de workspace
-- (createWorkspace), acceptation d'invitation par token (getByToken/accept) — tournent sur systemDb
-- (bypass RLS), gardées par leur propre auth (session + requête membership, ou token bearer). C'est
-- ce qui résout l'œuf/poule : on ne peut pas exiger un contexte tenant pour DÉTERMINER le tenant.
--
-- `tenant` n'a pas de colonne tenant_id : sa policy porte sur `id` (une ligne tenant n'est visible
-- que si elle EST le tenant du contexte courant).

ALTER TABLE "tenant" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_self_isolation" ON "tenant" USING (id = current_setting('app.tenant_id')::uuid) WITH CHECK (id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint

ALTER TABLE "membership" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "membership_tenant_isolation" ON "membership" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint

ALTER TABLE "invitation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "invitation_tenant_isolation" ON "invitation" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
