import db from "../../src/database/knex.js";

type Criteria = Record<string, string>;

const tracked: { table: string; criteria: Criteria }[] = [];

// Called by every helper that creates a row through the API, so cleanupTestData() removes it once this
// test file's run finishes. Never call this for the seeded super admin (loginAsSuperAdmin) — it isn't
// test-created data and must survive the run, same as before this file existed.
export function trackForCleanup(table: string, criteria: Criteria): void {
  tracked.push({ table, criteria });
}

// Children before the parents they reference, so a delete is never blocked by a foreign key.
// carOwnerProfiles/riderProfiles/adminUsers/vehicles have no ON DELETE action on their users FK, and
// adminUsers.roleId is ON DELETE RESTRICT — those rows must go before the user/role they reference.
// verificationDocuments/verificationDocumentHistory/rolePermissions cascade on their own when their
// parent is deleted; they're listed anyway so the order stays self-documenting.
const DELETE_ORDER = [
  "verificationDocumentHistory",
  "verificationDocuments",
  "vehicles",
  "carOwnerProfiles",
  "riderProfiles",
  "adminUsers",
  "authSessions",
  "otpCodes",
  "roles",
  "settings",
  "users",
];

// Run once per test file, from tests/setup.ts's afterAll, before that file's connection pool closes.
export async function cleanupTestData(): Promise<void> {
  for (const table of DELETE_ORDER) {
    for (const { criteria } of tracked.filter((t) => t.table === table)) {
      await db(table).where(criteria).del();
    }
  }
  tracked.length = 0;
}
