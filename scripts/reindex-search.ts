// No implicit .env loading or null-search success: same guarded production entry.
// pnpm search:reindex --target host:port/database/user --search http://host:port/index
process.argv.splice(2, 0, "reindex");
void import("./production");
