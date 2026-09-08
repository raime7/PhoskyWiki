CREATE TABLE "interest_tags" (
	"user_id" text NOT NULL,
	"interpreter_id" integer,
	"school_id" integer,
	"category_id" integer,
	CONSTRAINT "interest_tags_unique" UNIQUE NULLS NOT DISTINCT("user_id","interpreter_id","school_id","category_id"),
	CONSTRAINT "interest_tags_exactly_one_target" CHECK (num_nonnulls("interest_tags"."interpreter_id", "interest_tags"."school_id", "interest_tags"."category_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "interest_tags" ADD CONSTRAINT "interest_tags_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_tags" ADD CONSTRAINT "interest_tags_interpreter_id_interpreters_page_id_fk" FOREIGN KEY ("interpreter_id") REFERENCES "public"."interpreters"("page_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_tags" ADD CONSTRAINT "interest_tags_school_id_schools_page_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("page_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_tags" ADD CONSTRAINT "interest_tags_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interest_tags_user_idx" ON "interest_tags" USING btree ("user_id");