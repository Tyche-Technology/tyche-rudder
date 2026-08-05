ALTER TABLE "users" DROP CONSTRAINT "users_portal_id_unique";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "portal_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "password_hash";