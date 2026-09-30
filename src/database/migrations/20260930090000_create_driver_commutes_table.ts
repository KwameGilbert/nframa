import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("driverCommutes", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("userId").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.string("startAddress").notNullable();
    table.decimal("startLat", 9, 6).notNullable();
    table.decimal("startLng", 9, 6).notNullable();
    table.string("endAddress").notNullable();
    table.decimal("endLat", 9, 6).notNullable();
    table.decimal("endLng", 9, 6).notNullable();
    table.time("departureTime").notNullable(); // HH:MM format
    table.specificType("recurrenceDays", "smallint[]").notNullable(); // ISO 1–7 (Mon–Sun)
    table.integer("capacity").notNullable(); // number of available seats
    table.boolean("isActive").notNullable().defaultTo(true);
    table.timestamp("createdAt").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updatedAt").notNullable().defaultTo(knex.fn.now());

    table.index(["userId", "isActive"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("driverCommutes");
}
