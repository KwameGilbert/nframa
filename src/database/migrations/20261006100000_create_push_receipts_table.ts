import type { Knex } from "knex";

// Expo receipt tracking: one row per pushed notification ticket. Swept every minute to check delivery status
// and cleaned up after 7 days. Receipt ids are sent here by enqueueExpoReceipts, and fetchAndProcessReceipts
// polls the Expo API and marks them as handled once we know the outcome.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("pushReceipts", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.text("receiptId").notNullable().unique();
    table.text("token").notNullable();
    table.boolean("handled").notNullable().defaultTo(false);
    table.timestamp("createdAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(
    `CREATE INDEX "pushReceipts_handled_created" ON "pushReceipts" ("handled", "createdAt" DESC)`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("pushReceipts");
}
