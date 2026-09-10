CREATE TABLE "write_limits" (
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"attempts" integer NOT NULL,
	"admitted" bigint NOT NULL,
	"denied" bigint NOT NULL,
	CONSTRAINT "write_limits_user_id_kind_pk" PRIMARY KEY("user_id","kind")
);
--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "expired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "staging_cleaned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "write_limits" ADD CONSTRAINT "write_limits_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;