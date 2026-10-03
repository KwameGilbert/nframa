import type { Knex } from "knex";

// A rider's tip to the driver is two ledger rows for the same trip (a debit and a credit), both of type "tip".
// transactions_one_per_trip_type only covers trip_charge, wait_charge and driver_earning, so it doesn't apply.
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_type_check";
    ALTER TABLE "transactions" ADD CONSTRAINT "transactions_type_check" CHECK ("type" IN ('topup', 'trip_charge', 'wait_charge', 'driver_earning', 'refund', 'tip'));
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_type_check";
    ALTER TABLE "transactions" ADD CONSTRAINT "transactions_type_check" CHECK ("type" IN ('topup', 'trip_charge', 'wait_charge', 'driver_earning', 'refund'));
  `);
}
