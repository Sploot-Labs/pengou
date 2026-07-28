ALTER TABLE "question" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE "question" q SET "tenant_id" = z."tenant_id" FROM "quiz" z WHERE z."id" = q."quiz_id";--> statement-breakpoint
ALTER TABLE "question" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "question_tenant_idx" ON "question" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_id_tenant_uidx" ON "quiz" USING btree ("id","tenant_id");--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_quiz_tenant_fk" FOREIGN KEY ("quiz_id","tenant_id") REFERENCES "public"."quiz"("id","tenant_id") ON DELETE no action ON UPDATE no action;
