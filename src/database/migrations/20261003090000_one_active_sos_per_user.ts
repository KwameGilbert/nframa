import type { Knex } from "knex";

// A person has at most one alert in play at a time (triggered, underReview or servicesContacted): pressing the
// button twice, or two phones doing it at once, must not raise two alerts. The database is what refuses it.
export async function up(knex: Knex): Promise<void> {
  await knex.raw(
    `CREATE UNIQUE INDEX "sosIncidents_one_active_per_user" ON "sosIncidents" ("userId") WHERE "status" IN ('triggered', 'underReview', 'servicesContacted')`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS "sosIncidents_one_active_per_user"`);
}
