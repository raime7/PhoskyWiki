CREATE TYPE "public"."page_type" AS ENUM('term', 'perspective', 'interpreter', 'school', 'disambiguation');--> statement-breakpoint
CREATE TABLE "interpreters" (
	"page_id" integer PRIMARY KEY NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"birth_year" integer,
	"death_year" integer,
	"is_editorial_board" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "links" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_page_id" integer NOT NULL,
	"target_page_id" integer,
	"target_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" "page_type" NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "perspectives" (
	"page_id" integer PRIMARY KEY NOT NULL,
	"term_id" integer NOT NULL,
	"interpreter_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"page_id" integer NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "terms" (
	"page_id" integer PRIMARY KEY NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interpreters" ADD CONSTRAINT "interpreters_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_source_page_id_pages_id_fk" FOREIGN KEY ("source_page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_target_page_id_pages_id_fk" FOREIGN KEY ("target_page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perspectives" ADD CONSTRAINT "perspectives_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perspectives" ADD CONSTRAINT "perspectives_term_id_terms_page_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("page_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perspectives" ADD CONSTRAINT "perspectives_interpreter_id_interpreters_page_id_fk" FOREIGN KEY ("interpreter_id") REFERENCES "public"."interpreters"("page_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "links_source_name_unique" ON "links" USING btree ("source_page_id","target_name");--> statement-breakpoint
CREATE INDEX "links_target_idx" ON "links" USING btree ("target_page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pages_term_title_unique" ON "pages" USING btree ("title") WHERE type = 'term';--> statement-breakpoint
CREATE INDEX "pages_type_idx" ON "pages" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "perspectives_term_interpreter_unique" ON "perspectives" USING btree ("term_id","interpreter_id");--> statement-breakpoint
CREATE INDEX "revisions_page_idx" ON "revisions" USING btree ("page_id","id");