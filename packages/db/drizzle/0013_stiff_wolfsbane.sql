ALTER TABLE "answer_record" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "answer_record" ADD CONSTRAINT "answer_record_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE "answer_record" ar SET "tenant_id" = gs."tenant_id" FROM "game_session" gs WHERE gs."id" = ar."session_id";--> statement-breakpoint
ALTER TABLE "answer_record" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "answer_record_tenant_idx" ON "answer_record" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "answer_record" ADD CONSTRAINT "answer_record_session_tenant_fk" FOREIGN KEY ("session_id","tenant_id") REFERENCES "public"."game_session"("id","tenant_id") ON DELETE no action ON UPDATE no action;
