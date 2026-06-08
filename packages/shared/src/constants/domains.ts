// System domain UUIDs. These are real database rows (created in migration
// 0026) but the application code references them as constants so we don't
// pay a runtime lookup for the catch-all routing decision.
//
// If the migration ever needs to recreate Inbox (DB rebuild, dev seed,
// etc.), the same UUID must be used — see infrastructure/migrations/
// 0026_retire_areas.sql for the INSERT.

export const INBOX_DOMAIN_ID = 'acf035ee-b247-4c96-a07e-5946bc2b2e91';
