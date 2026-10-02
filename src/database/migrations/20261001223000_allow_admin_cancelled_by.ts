import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE "trips" DROP CONSTRAINT IF EXISTS "trips_cancelledBy_check";
    ALTER TABLE "trips" DROP CONSTRAINT IF EXISTS "trips_cancelledby_check";
    ALTER TABLE "trips" ADD CONSTRAINT "trips_cancelledBy_check" CHECK ("cancelledBy" IN ('rider', 'driver', 'system', 'admin'));
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE "trips" DROP CONSTRAINT IF EXISTS "trips_cancelledBy_check";
    ALTER TABLE "trips" DROP CONSTRAINT IF EXISTS "trips_cancelledby_check";
    ALTER TABLE "trips" ADD CONSTRAINT "trips_cancelledBy_check" CHECK ("cancelledBy" IN ('rider', 'driver', 'system'));
  `);
}