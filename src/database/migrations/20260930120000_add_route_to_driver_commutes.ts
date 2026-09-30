import type { Knex } from "knex";

// The driving distance and time between a commute's start and end, saved when it is created or moved.
// Nullable: commutes that already exist stay null.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("driverCommutes", (table) => {
    table.integer("distanceMeters").nullable();
    table.integer("durationSeconds").nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("driverCommutes", (table) => {
    table.dropColumn("distanceMeters");
    table.dropColumn("durationSeconds");
  });
}
