import type { Knex } from "knex";

// pendingBalance: driver earnings still in their hold period (not yet withdrawable). status/frozen*: an admin can
// freeze a wallet, which blocks money leaving it (trip holds, payouts, adjustment debits) but not money arriving.
// (The balance >= 0 check comes in the next migration, which can record a ledger row for each negative balance.)
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("wallets", (table) => {
    table.decimal("pendingBalance", 12, 2).notNullable().defaultTo(0);
    table.string("status", 10).notNullable().defaultTo("active").checkIn(["active", "frozen"]);
    table.timestamp("frozenAt").nullable();
    table.uuid("frozenBy").nullable().references("id").inTable("users").onDelete("SET NULL");
    table.text("frozenReason").nullable();
  });
  await knex.raw(
    `ALTER TABLE "wallets" ADD CONSTRAINT "wallets_pending_balance_check" CHECK ("pendingBalance" >= 0)`,
  );
}

export async function down(knex: Knex): Promise<void> {
  // Held money lives only in pendingBalance: dropping it would make drivers' earnings vanish.
  const held = await knex("wallets").where("pendingBalance", ">", 0).first("userId");
  if (held) {
    throw new Error("Refusing to roll back: some wallets still hold pendingBalance. Release it first.");
  }
  await knex.raw(`ALTER TABLE "wallets" DROP CONSTRAINT IF EXISTS "wallets_pending_balance_check"`);
  await knex.schema.alterTable("wallets", (table) => {
    table.dropForeign(["frozenBy"]);
    table.dropColumns("pendingBalance", "status", "frozenAt", "frozenBy", "frozenReason");
  });
}
