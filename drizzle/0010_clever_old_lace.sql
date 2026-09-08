CREATE TABLE "discussion_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"term_id" integer NOT NULL,
	"perspective_id" integer,
	"parent_id" integer,
	"content" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"author_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "term_discussions" (
	"term_id" integer PRIMARY KEY NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text
);
--> statement-breakpoint
ALTER TABLE "discussion_posts" ADD CONSTRAINT "discussion_posts_term_id_terms_page_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("page_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_posts" ADD CONSTRAINT "discussion_posts_perspective_id_perspectives_page_id_fk" FOREIGN KEY ("perspective_id") REFERENCES "public"."perspectives"("page_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_posts" ADD CONSTRAINT "discussion_posts_parent_id_discussion_posts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."discussion_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_posts" ADD CONSTRAINT "discussion_posts_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_posts" ADD CONSTRAINT "discussion_posts_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_discussions" ADD CONSTRAINT "term_discussions_term_id_terms_page_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("page_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_discussions" ADD CONSTRAINT "term_discussions_locked_by_user_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discussion_posts_term_idx" ON "discussion_posts" USING btree ("term_id","id");--> statement-breakpoint
CREATE INDEX "discussion_posts_parent_idx" ON "discussion_posts" USING btree ("parent_id");