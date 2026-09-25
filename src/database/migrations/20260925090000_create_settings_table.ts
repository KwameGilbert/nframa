import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Admin-managed platform settings, one row per key. value is jsonb so a setting can hold a string, number,
  // boolean or a JSON object/array; type records which, and the API checks every write against it.
  await knex.schema.createTable("settings", (table) => {
    table.text("key").primary();
    table.text("type").notNullable().checkIn(["string", "number", "boolean", "json"]);
    table.jsonb("value").notNullable();
    table.text("description");
    table.uuid("updatedBy").references("id").inTable("users").onDelete("SET NULL");
    table.timestamp("createdAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("settings");
}
