CREATE TABLE "attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"issue_id" integer NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"gcs_object" text NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_user_id" integer,
	"actor_token_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_gcs_object_unique" UNIQUE("gcs_object"),
	CONSTRAINT "attachments_actor_xor" CHECK (("attachments"."actor_type" = 'user' AND "attachments"."actor_user_id" IS NOT NULL AND "attachments"."actor_token_id" IS NULL)
     OR ("attachments"."actor_type" = 'agent' AND "attachments"."actor_token_id" IS NOT NULL AND "attachments"."actor_user_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_actor_token_id_api_tokens_id_fk" FOREIGN KEY ("actor_token_id") REFERENCES "public"."api_tokens"("id") ON DELETE restrict ON UPDATE no action;