ALTER TABLE "game_session" DROP CONSTRAINT "game_session_host_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "membership" DROP CONSTRAINT "membership_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "oauth_account" DROP CONSTRAINT "oauth_account_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "quiz" DROP CONSTRAINT "quiz_owner_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "game_session" ALTER COLUMN "host_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "membership" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "oauth_account" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "quiz" ALTER COLUMN "owner_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "game_session" ADD CONSTRAINT "game_session_host_id_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_account" ADD CONSTRAINT "oauth_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz" ADD CONSTRAINT "quiz_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
