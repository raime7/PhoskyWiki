CREATE TABLE "search_maintenance" (
	"index_uid" text PRIMARY KEY NOT NULL,
	"degraded" boolean DEFAULT false NOT NULL,
	"last_failure_at" timestamp with time zone,
	"last_reindex_at" timestamp with time zone,
	"last_reindex_result" text DEFAULT 'never' NOT NULL
);
