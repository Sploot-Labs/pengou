ALTER TABLE "session_player" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "session_player" ADD CONSTRAINT "session_player_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE "session_player" sp SET "tenant_id" = gs."tenant_id" FROM "game_session" gs WHERE gs."id" = sp."session_id";--> statement-breakpoint
ALTER TABLE "session_player" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "session_player_tenant_idx" ON "session_player" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "game_session_id_tenant_uidx" ON "game_session" USING btree ("id","tenant_id");--> statement-breakpoint
ALTER TABLE "session_player" ADD CONSTRAINT "session_player_session_tenant_fk" FOREIGN KEY ("session_id","tenant_id") REFERENCES "public"."game_session"("id","tenant_id") ON DELETE no action ON UPDATE no action;
