CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"parent_id" integer
);
--> statement-breakpoint
CREATE TABLE "school_members" (
	"school_id" integer NOT NULL,
	"interpreter_id" integer NOT NULL,
	CONSTRAINT "school_members_pk" PRIMARY KEY("school_id","interpreter_id")
);
--> statement-breakpoint
CREATE TABLE "schools" (
	"page_id" integer PRIMARY KEY NOT NULL,
	"summary" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "term_categories" (
	"term_id" integer NOT NULL,
	"category_id" integer NOT NULL,
	CONSTRAINT "term_categories_pk" PRIMARY KEY("term_id","category_id")
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_members" ADD CONSTRAINT "school_members_school_id_schools_page_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("page_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_members" ADD CONSTRAINT "school_members_interpreter_id_interpreters_page_id_fk" FOREIGN KEY ("interpreter_id") REFERENCES "public"."interpreters"("page_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schools" ADD CONSTRAINT "schools_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_categories" ADD CONSTRAINT "term_categories_term_id_terms_page_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("page_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_categories" ADD CONSTRAINT "term_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_name_unique" ON "categories" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_unique" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "categories_parent_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "school_members_interpreter_idx" ON "school_members" USING btree ("interpreter_id");--> statement-breakpoint
CREATE INDEX "term_categories_category_idx" ON "term_categories" USING btree ("category_id");