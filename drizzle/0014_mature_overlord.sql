ALTER TABLE "interpreters" ADD COLUMN "key_texts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "key_texts" jsonb;--> statement-breakpoint
ALTER TABLE "terms" ADD COLUMN "key_texts" jsonb DEFAULT '[]'::jsonb NOT NULL;