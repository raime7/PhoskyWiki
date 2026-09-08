ALTER TABLE "revisions" ADD COLUMN "snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "revisions" ADD COLUMN "source" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "revisions" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Preserve legacy rows; this timestamp is the start of recoverable metadata history.
INSERT INTO revisions (page_id, content, snapshot, source)
SELECT p.id, '', jsonb_build_object('version', 1, 'type', 'term', 'title', p.title, 'summary', t.summary, 'aliases', to_jsonb(t.aliases)), 'baseline'
FROM pages p JOIN terms t ON t.page_id = p.id
WHERE NOT EXISTS (SELECT 1 FROM revisions r WHERE r.page_id = p.id AND r.snapshot IS NOT NULL);
