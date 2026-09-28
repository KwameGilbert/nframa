import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.table("verificationDocuments", (table) => {
    table.timestamp("deletedAt", { useTz: true }).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.table("verificationDocuments", (table) => {
    table.dropColumn("deletedAt");
  });
}
