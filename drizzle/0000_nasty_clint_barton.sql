CREATE TYPE "public"."actor_type" AS ENUM('user', 'agent');--> statement-breakpoint
CREATE TYPE "public"."issue_type" AS ENUM('bug', 'feature', 'improvement');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('p0', 'p1', 'p2');--> statement-breakpoint
CREATE TYPE "public"."relation_kind" AS ENUM('duplicate', 'relates', 'blocks');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'user');--> statement-breakpoint
CREATE TYPE "public"."status" AS ENUM('inbox', 'backlog', 'in_progress', 'done', 'rejected', 'on_hold');--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"issue_id" integer NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_user_id" integer,
	"actor_token_id" integer,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "comments_actor_xor" CHECK (("comments"."actor_type" = 'user' AND "comments"."actor_user_id" IS NOT NULL AND "comments"."actor_token_id" IS NULL)
     OR ("comments"."actor_type" = 'agent' AND "comments"."actor_token_id" IS NOT NULL AND "comments"."actor_user_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "issue_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"issue_id" integer NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_user_id" integer,
	"actor_token_id" integer,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "issue_events_actor_xor" CHECK (("issue_events"."actor_type" = 'user' AND "issue_events"."actor_user_id" IS NOT NULL AND "issue_events"."actor_token_id" IS NULL)
     OR ("issue_events"."actor_type" = 'agent' AND "issue_events"."actor_token_id" IS NOT NULL AND "issue_events"."actor_user_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "issue_relations" (
	"id" serial PRIMARY KEY NOT NULL,
	"issue_id" integer NOT NULL,
	"related_issue_id" integer NOT NULL,
	"kind" "relation_kind" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"type" "issue_type" NOT NULL,
	"product_id" integer NOT NULL,
	"status" "status" DEFAULT 'inbox' NOT NULL,
	"priority" "priority",
	"requester_id" integer NOT NULL,
	"assignee_id" integer,
	"milestone_id" integer,
	"sort_order" double precision,
	"reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"starts_on" timestamp,
	"ends_on" timestamp,
	"closed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "milestones_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "products_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"portal_id" text NOT NULL,
	"name" text NOT NULL,
	"role" "role" DEFAULT 'user' NOT NULL,
	"password_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_portal_id_unique" UNIQUE("portal_id")
);
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_actor_token_id_api_tokens_id_fk" FOREIGN KEY ("actor_token_id") REFERENCES "public"."api_tokens"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_events" ADD CONSTRAINT "issue_events_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_events" ADD CONSTRAINT "issue_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_events" ADD CONSTRAINT "issue_events_actor_token_id_api_tokens_id_fk" FOREIGN KEY ("actor_token_id") REFERENCES "public"."api_tokens"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_relations" ADD CONSTRAINT "issue_relations_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_relations" ADD CONSTRAINT "issue_relations_related_issue_id_issues_id_fk" FOREIGN KEY ("related_issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_relation" ON "issue_relations" USING btree ("issue_id","related_issue_id","kind");