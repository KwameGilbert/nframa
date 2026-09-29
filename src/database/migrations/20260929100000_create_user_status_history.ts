import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("userStatusHistory", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("userId").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.string("previousStatus", 20).notNullable(); // active or suspended
    table.string("newStatus", 20).notNullable(); // active or suspended
    table.text("reason").nullable(); // Why the status changed (e.g. shown to the account holder)
    table.text("notes").nullable(); // Internal admin-only notes, not surfaced to the account holder
    table.uuid("changedBy").references("id").inTable("users").onDelete("SET NULL"); // Admin who made the change
    table.timestamp("changedAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("createdAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index("userId");
    table.index("changedAt");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("userStatusHistory");
}
