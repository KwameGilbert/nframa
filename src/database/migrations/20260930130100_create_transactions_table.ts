import type { Knex } from "knex";

// The money ledger: every change to a wallet balance has a row here. A wallet's balance always equals the
// signed sum of its successful rows.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("transactions", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    // RESTRICT: a ledger must not vanish with its user (users are soft-deleted anyway).
    table.uuid("userId").notNullable().references("id").inTable("users").onDelete("RESTRICT");
    table
      .string("type", 20)
      .notNullable()
      .checkIn(["topup", "trip_charge", "wait_charge", "driver_earning", "refund"]);
    table.string("direction", 10).notNullable().checkIn(["credit", "debit"]);
    table.decimal("amount", 12, 2).notNullable().checkPositive();
    table.text("currency").notNullable().defaultTo("GHS");
    table
      .string("status", 10)
      .notNullable()
      .defaultTo("pending")
      .checkIn(["pending", "success", "failed"]);
    table.text("provider").nullable();
    table.text("providerReference").nullable().unique();
    table.uuid("tripId").nullable(); // no FK yet: the trips table comes later
    table.decimal("balanceAfter", 12, 2).nullable(); // set when the transaction succeeds
    table.jsonb("metadata").nullable();
    table.timestamp("createdAt").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updatedAt").notNullable().defaultTo(knex.fn.now());

    table.index(["userId", "createdAt"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("transactions");
}
