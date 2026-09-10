CREATE TABLE "access_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"digest" text NOT NULL,
	"target_user_id" text,
	"issued_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "access_grants_digest_unique" UNIQUE("digest"),
	CONSTRAINT "access_grant_purpose_target" CHECK (("access_grants"."purpose" = 'invitation' and "access_grants"."target_user_id" is null) or ("access_grants"."purpose" = 'reset' and "access_grants"."target_user_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_target_user_id_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_grants_target_idx" ON "access_grants" USING btree ("target_user_id");