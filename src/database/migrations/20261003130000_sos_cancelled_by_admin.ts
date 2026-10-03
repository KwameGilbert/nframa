import type { Knex } from "knex";

// Staff can call an alert off (a false alarm, a duplicate): a status alongside cancelledByUser. Like it, it is
// not in play, so the one-active-alert-per-person index (which lists the in-play statuses) doesn't need to change.
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE "sosIncidents" DROP CONSTRAINT IF EXISTS "sosIncidents_status_check";
    ALTER TABLE "sosIncidents" ADD CONSTRAINT "sosIncidents_status_check" CHECK ("status" IN ('triggered', 'underReview', 'servicesContacted', 'resolved', 'cancelledByUser', 'cancelledByAdmin'));
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    UPDATE "sosIncidents" SET "status" = 'cancelledByUser' WHERE "status" = 'cancelledByAdmin';
    ALTER TABLE "sosIncidents" DROP CONSTRAINT IF EXISTS "sosIncidents_status_check";
    ALTER TABLE "sosIncidents" ADD CONSTRAINT "sosIncidents_status_check" CHECK ("status" IN ('triggered', 'underReview', 'servicesContacted', 'resolved', 'cancelledByUser'));
  `);
}
