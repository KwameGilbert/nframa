import type { Knex } from "knex";

// Ties trip money to its trip, and lets the database refuse a second charge or payout for the same trip.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("transactions", (table) => {
    table.foreign("tripId").references("id").inTable("trips").onDelete("RESTRICT");
    table.index(["tripId"]);
  });
  await knex.raw(
    `CREATE UNIQUE INDEX "transactions_one_per_trip_type" ON "transactions" ("tripId", "type") WHERE "type" IN ('trip_charge', 'wait_charge', 'driver_earning')`,
  );
  await knex.raw(
    `ALTER TABLE "wallets" ADD CONSTRAINT "wallets_held_amount_check" CHECK ("heldAmount" >= 0)`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE "wallets" DROP CONSTRAINT IF EXISTS "wallets_held_amount_check"`);
  await knex.raw(`DROP INDEX IF EXISTS "transactions_one_per_trip_type"`);
  await knex.schema.alterTable("transactions", (table) => {
    table.dropIndex(["tripId"]);
    table.dropForeign(["tripId"]);
  });
}
