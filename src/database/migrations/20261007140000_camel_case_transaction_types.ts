import type { Knex } from "knex";

// Stored transaction types become camelCase like every other enum value. topup, refund and tip are unchanged.
const RENAMES: [string, string][] = [
  ["trip_charge", "tripCharge"],
  ["wait_charge", "waitCharge"],
  ["driver_earning", "driverEarning"],
];

async function rename(knex: Knex, types: string[], perTrip: string[], pairs: [string, string][]) {
  const list = (values: string[]) => values.map((v) => `'${v}'`).join(", ");
  await knex.raw(`ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_type_check"`);
  await knex.raw(`DROP INDEX IF EXISTS "transactions_one_per_trip_type"`);
  for (const [from, to] of pairs) {
    await knex("transactions").where({ type: from }).update({ type: to });
  }
  await knex.raw(
    `ALTER TABLE "transactions" ADD CONSTRAINT "transactions_type_check" CHECK ("type" IN (${list(types)}))`,
  );
  await knex.raw(
    `CREATE UNIQUE INDEX "transactions_one_per_trip_type" ON "transactions" ("tripId", "type") WHERE "type" IN (${list(perTrip)})`,
  );
}

export async function up(knex: Knex): Promise<void> {
  await rename(
    knex,
    ["topup", "tripCharge", "waitCharge", "driverEarning", "refund", "tip"],
    ["tripCharge", "waitCharge", "driverEarning"],
    RENAMES,
  );
}

export async function down(knex: Knex): Promise<void> {
  await rename(
    knex,
    ["topup", "trip_charge", "wait_charge", "driver_earning", "refund", "tip"],
    ["trip_charge", "wait_charge", "driver_earning"],
    RENAMES.map(([from, to]) => [to, from]),
  );
}
