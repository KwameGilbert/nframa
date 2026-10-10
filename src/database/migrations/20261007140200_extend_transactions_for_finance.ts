import type { Knex } from "knex";

const OLD_TYPES = ["topup", "tripCharge", "waitCharge", "driverEarning", "refund", "tip"];
const NEW_TYPES = ["platformFee", "payout", "adjustmentCredit", "adjustmentDebit"];
const list = (values: string[]) => values.map((v) => `'${v}'`).join(", ");

// The ledger becomes the source of truth for platform revenue, payouts and admin adjustments:
// - account: "platform" rows (the platform's fee per trip) belong to no user, so userId is null exactly then.
// - actorId + note: who made an admin change and why; a row with an actor always has a note.
// - availableAt: when a held driver credit (earning or tip) may be released into the balance.
// - an append-only trigger: rows are never deleted, and the only change allowed is a pending row settling
//   (success|failed) with its balanceAfter/metadata. Test cleanup bypasses it with SET LOCAL ledger.allowDelete.
// - wallets.balance can no longer go below zero (wait charges are capped at what the rider can spend). A wallet
//   already negative is brought to zero with an adjustmentCredit, so its ledger still adds up to its balance.
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_type_check";
    ALTER TABLE "transactions" ADD CONSTRAINT "transactions_type_check" CHECK ("type" IN (${list([...OLD_TYPES, ...NEW_TYPES])}));
    DROP INDEX IF EXISTS "transactions_one_per_trip_type";
    CREATE UNIQUE INDEX "transactions_one_per_trip_type" ON "transactions" ("tripId", "type")
      WHERE "type" IN ('tripCharge', 'waitCharge', 'driverEarning', 'platformFee');
  `);

  await knex.schema.alterTable("transactions", (table) => {
    table.string("account", 10).notNullable().defaultTo("user").checkIn(["user", "platform"]);
    table.uuid("userId").nullable().alter();
    // RESTRICT, like userId: SET NULL would rewrite ledger rows, which the trigger forbids.
    table.uuid("actorId").references("id").inTable("users").onDelete("RESTRICT");
    table.text("note");
    table.timestamp("availableAt");
    table.index(["type", "createdAt"]);
  });

  await knex.raw(`
    ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_user_check" CHECK (("account" = 'platform') = ("userId" IS NULL));
    ALTER TABLE "transactions" ADD CONSTRAINT "transactions_actor_note_check" CHECK ("actorId" IS NULL OR "note" IS NOT NULL);
    CREATE INDEX "transactions_due_release" ON "transactions" ("availableAt")
      WHERE "status" = 'pending' AND "availableAt" IS NOT NULL;

    INSERT INTO "transactions" ("userId", "type", "direction", "amount", "status", "balanceAfter", "note")
      SELECT "userId", 'adjustmentCredit', 'credit', -"balance", 'success', 0,
        'Negative balance cleared when balances became non-negative'
      FROM "wallets" WHERE "balance" < 0;
    UPDATE "wallets" SET "balance" = 0, "updatedAt" = now() WHERE "balance" < 0;
    ALTER TABLE "wallets" ADD CONSTRAINT "wallets_balance_check" CHECK ("balance" >= 0);

    CREATE FUNCTION "transactionsAppendOnly"() RETURNS trigger AS $$
    DECLARE
      settleable text[] := ARRAY['status', 'balanceAfter', 'metadata', 'updatedAt'];
    BEGIN
      IF current_setting('ledger.allowDelete', true) = 'on' THEN
        RETURN COALESCE(NEW, OLD);
      END IF;
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'transactions is append-only: rows cannot be deleted';
      END IF;
      IF OLD."status" <> 'pending' OR NEW."status" NOT IN ('success', 'failed')
        OR (to_jsonb(NEW) - settleable) <> (to_jsonb(OLD) - settleable) THEN
        RAISE EXCEPTION 'transactions is append-only: only a pending row can settle';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER "transactionsAppendOnly" BEFORE UPDATE OR DELETE ON "transactions"
      FOR EACH ROW EXECUTE FUNCTION "transactionsAppendOnly"();
  `);
}

export async function down(knex: Knex): Promise<void> {
  // The old schema has no place for these rows, and deleting them would leave wallet balances that the ledger
  // no longer explains (a paid-out payout, an adjustment). Only a ledger without them can roll back.
  const unrepresentable = await knex("transactions")
    .whereIn("type", NEW_TYPES)
    .orWhere({ account: "platform" })
    .first("id");
  if (unrepresentable) {
    throw new Error(
      "Refusing to roll back: the ledger has platform, payout or adjustment rows the old schema can't hold.",
    );
  }
  await knex.raw(`
    ALTER TABLE "wallets" DROP CONSTRAINT IF EXISTS "wallets_balance_check";
    DROP TRIGGER IF EXISTS "transactionsAppendOnly" ON "transactions";
    DROP FUNCTION IF EXISTS "transactionsAppendOnly"();
    DROP INDEX IF EXISTS "transactions_due_release";
    ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_actor_note_check";
    ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_account_user_check";
  `);
  await knex.schema.alterTable("transactions", (table) => {
    table.dropIndex(["type", "createdAt"]);
    table.dropForeign(["actorId"]);
    table.dropColumns("account", "actorId", "note", "availableAt");
    table.uuid("userId").notNullable().alter();
  });

  await knex.raw(`
    DROP INDEX IF EXISTS "transactions_one_per_trip_type";
    CREATE UNIQUE INDEX "transactions_one_per_trip_type" ON "transactions" ("tripId", "type")
      WHERE "type" IN ('tripCharge', 'waitCharge', 'driverEarning');
    ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_type_check";
    ALTER TABLE "transactions" ADD CONSTRAINT "transactions_type_check" CHECK ("type" IN (${list(OLD_TYPES)}));
  `);
}
