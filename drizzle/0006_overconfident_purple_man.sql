CREATE TYPE "public"."submission_kind" AS ENUM('edit', 'new_term', 'new_perspective', 'new_interpreter');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."submission_vote" AS ENUM('approve', 'reject');--> statement-breakpoint
CREATE TABLE "submission_votes" (
	"id" serial PRIMARY KEY NOT NULL,
	"submission_id" integer NOT NULL,
	"admin_id" text NOT NULL,
	"vote" "submission_vote" NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"page_id" integer,
	"kind" "submission_kind" NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"title" text,
	"summary" text,
	"term_id" integer,
	"interpreter_id" integer,
	"base_revision_id" integer,
	"status" "submission_status" DEFAULT 'pending' NOT NULL,
	"quorum" integer NOT NULL,
	"rejection_reason" text,
	"submitted_by" text NOT NULL,
	"supersedes_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "submission_votes" ADD CONSTRAINT "submission_votes_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_votes" ADD CONSTRAINT "submission_votes_admin_id_user_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_term_id_terms_page_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("page_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_interpreter_id_interpreters_page_id_fk" FOREIGN KEY ("interpreter_id") REFERENCES "public"."interpreters"("page_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_base_revision_id_revisions_id_fk" FOREIGN KEY ("base_revision_id") REFERENCES "public"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_supersedes_id_submissions_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "submission_votes_admin_unique" ON "submission_votes" USING btree ("submission_id","admin_id");--> statement-breakpoint
CREATE INDEX "submission_votes_submission_idx" ON "submission_votes" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "submissions_status_idx" ON "submissions" USING btree ("status","id");--> statement-breakpoint
CREATE INDEX "submissions_submitter_idx" ON "submissions" USING btree ("submitted_by");