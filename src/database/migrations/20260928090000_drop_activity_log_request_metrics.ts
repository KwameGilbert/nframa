import type { Knex } from "knex";

// Activity is now logged by each controller once its action is done, not by middleware wrapping the whole
// request, so the response's status code and the request's duration are no longer there to record.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("activityLogs", (table) => {
    table.dropColumn("statusCode");
    table.dropColumn("durationMs");
  });
}

// Back as nullable: rows written in between have no value for them.
export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("activityLogs", (table) => {
    table.integer("statusCode").nullable();
    table.integer("durationMs").nullable();
  });
}
