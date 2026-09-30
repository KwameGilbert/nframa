import type { Knex } from "knex";

// One wallet per account, created the first time money moves. heldAmount is money reserved for an accepted
// trip that hasn't been charged yet; what the rider can spend is balance - heldAmount.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("wallets", (table) => {
    table.uuid("userId").primary().references("id").inTable("users").onDelete("CASCADE");
    table.decimal("balance", 12, 2).notNullable().defaultTo(0);
    table.decimal("heldAmount", 12, 2).notNullable().defaultTo(0);
    table.timestamp("createdAt").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updatedAt").notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("wallets");
}
