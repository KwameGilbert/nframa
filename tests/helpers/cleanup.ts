import { randomUUID } from "node:crypto";
import db from "../../src/database/knex.js";
import { flushActivityLogs } from "../../src/services/activityLog.service.js";

type Criteria = Record<string, string>;

// Every request this test file sends carries an X-Request-Id starting with this (see api.ts), which the
// activity log records — so the file's log entries can be found and deleted without touching real ones.
export const REQUEST_ID_PREFIX = `test-${randomUUID()}-`;

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
  "transactions", // ON DELETE RESTRICT on users and trips: a ledger never vanishes with its user or trip
  "trips", // ON DELETE RESTRICT on users and driverCommutes
  "wallets",
  "verificationDocumentHistory",
  "verificationDocuments",
  "vehicles",
  "driverCommutes",
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
  await flushActivityLogs();
  await db("activityLogs").where("requestId", "like", `${REQUEST_ID_PREFIX}%`).del();

  for (const table of DELETE_ORDER) {
    for (const { criteria } of tracked.filter((t) => t.table === table)) {
      await db(table).where(criteria).del();
    }
  }
  tracked.length = 0;
}
