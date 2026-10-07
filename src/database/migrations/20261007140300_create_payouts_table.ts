import type { Knex } from "knex";

const STATUSES = ["pending", "approved", "paid", "rejected", "failed", "cancelled"];

// payouts replaces the never-used payoutHistory. Each payout owns one `payout` debit in transactions
// (transactionId), which settles when the payout is paid, rejected, failed or cancelled.
// - payoutMethodId is SET NULL: payout methods are hard-deleted, and the payout's history must survive that.
// - driverUserId, decidedBy and transactionId are RESTRICT: money history never disappears with its owner.
// - A driver has at most one open (pending or approved) payout.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("payouts", (table) => {
    table.uuid("id").primary();
    table.uuid("driverUserId").notNullable().references("id").inTable("users").onDelete("RESTRICT");
    table.uuid("payoutMethodId").references("id").inTable("payoutMethods").onDelete("SET NULL");
    table.decimal("amount", 12, 2).notNullable().checkPositive();
    table.string("status", 10).notNullable().defaultTo("pending").checkIn(STATUSES);
    table
      .uuid("transactionId")
      .notNullable()
      .unique()
      .references("id")
      .inTable("transactions")
      .onDelete("RESTRICT");
    table.uuid("decidedBy").references("id").inTable("users").onDelete("RESTRICT");
    table.timestamp("decidedAt");
    table.text("note");
    table.timestamp("createdAt").defaultTo(knex.fn.now()).notNullable();
    table.timestamp("updatedAt").defaultTo(knex.fn.now()).notNullable();
    table.index(["status", "createdAt"]);
    table.index(["driverUserId", "createdAt"]);
  });
  await knex.raw(`
    CREATE UNIQUE INDEX "payouts_one_open_per_driver" ON "payouts" ("driverUserId")
      WHERE "status" IN ('pending', 'approved');
  `);

  await knex.schema.alterTable("supportTickets", (table) => {
    table.dropForeign(["payoutId"]);
  });
  // payoutHistory was never written to, so no ticket points at a row in it.
  await knex("supportTickets").whereNotNull("payoutId").update({ payoutId: null });
  await knex.schema.alterTable("supportTickets", (table) => {
    table.foreign("payoutId").references("id").inTable("payouts").onDelete("SET NULL");
  });
  await knex.schema.dropTable("payoutHistory");
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("supportTickets", (table) => {
    table.dropForeign(["payoutId"]);
  });
  await knex("supportTickets").whereNotNull("payoutId").update({ payoutId: null });

  // As created by 20261003100200_create_payout_history_table.
  await knex.schema.createTable("payoutHistory", (table) => {
    table.uuid("id").primary();
    table.uuid("driverUserId").notNullable().references("users.id").onDelete("CASCADE");
    table.uuid("payoutMethodId").notNullable().references("payoutMethods.id");
    table.decimal("amount", 12, 2).notNullable().checkPositive();
    table.string("currency", 3).defaultTo("GHS");
    table.enum("status", ["pending", "processing", "completed", "failed"]).defaultTo("pending");
    table.string("providerReference", 255);
    table.string("failureReason", 500);
    table.uuid("initiatedBy").notNullable();
    table.enum("initiationType", ["manual", "automatic"]).defaultTo("manual");
    table.jsonb("metadata").defaultTo("{}");
    table.timestamp("initiatedAt").defaultTo(knex.fn.now()).notNullable();
    table.timestamp("completedAt");
    table.timestamp("createdAt").defaultTo(knex.fn.now()).notNullable();
    table.index(["driverUserId", "status"]);
    table.index(["status"]);
    table.index(["createdAt"]);
    table.index(["providerReference"]);
  });

  await knex.schema.alterTable("supportTickets", (table) => {
    table.foreign("payoutId").references("id").inTable("payoutHistory").onDelete("SET NULL");
  });
  await knex.schema.dropTable("payouts");
}
