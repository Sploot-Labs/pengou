ALTER TYPE "public"."session_status" ADD VALUE 'abandoned';--> statement-breakpoint
DROP INDEX "game_session_active_pin_uidx";--> statement-breakpoint
ALTER TABLE "game_session" ADD COLUMN "last_activity_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "game_session_active_pin_uidx" ON "game_session" USING btree ("pin") WHERE "game_session"."status" in ('lobby', 'active');