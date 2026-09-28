import type { Knex } from "knex";

// A driver can only be approved once they've submitted a document of every required type. Every existing
// type (national ID, license, registration, insurance, roadworthiness) is required; a type added later can
// opt out.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("documentTypes", (table) => {
    table.boolean("isRequired").notNullable().defaultTo(true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("documentTypes", (table) => {
    table.dropColumn("isRequired");
  });
}
