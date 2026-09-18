import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("riderProfiles", (table) => {
    table.uuid("userId").primary().references("id").inTable("users");
    table.timestamp("createdAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("riderProfiles");
}
