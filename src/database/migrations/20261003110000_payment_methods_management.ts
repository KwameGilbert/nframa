import type { Knex } from "knex";

// Payment methods are managed without a provider for now: the provider and its token are attached later,
// when charging and payouts are integrated, so both become optional. "identifier" is a normalized key of
// the account/card/number so the same one can't be saved twice.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("paymentMethods", (table) => {
    table.dropUnique(["userId", "tokenizedReference"]);
    table.string("identifier", 255);
  });
  await knex.raw(`ALTER TABLE "paymentMethods" ALTER COLUMN "tokenizedReference" DROP NOT NULL`);
  await knex.raw(`ALTER TABLE "paymentMethods" ALTER COLUMN "provider" DROP NOT NULL`);

  await knex.raw(
    `CREATE UNIQUE INDEX "paymentMethods_one_per_identifier" ON "paymentMethods" ("userId", "identifier") WHERE "isActive"`,
  );
  await knex.raw(
    `CREATE UNIQUE INDEX "paymentMethods_one_primary_per_user" ON "paymentMethods" ("userId") WHERE "isPrimary" AND "isActive"`,
  );
  await knex.raw(
    `CREATE UNIQUE INDEX "payoutMethods_one_primary_per_driver" ON "payoutMethods" ("driverUserId") WHERE "isPrimary"`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS "payoutMethods_one_primary_per_driver"`);
  await knex.raw(`DROP INDEX IF EXISTS "paymentMethods_one_primary_per_user"`);
  await knex.raw(`DROP INDEX IF EXISTS "paymentMethods_one_per_identifier"`);
  await knex.schema.alterTable("paymentMethods", (table) => {
    table.dropColumn("identifier");
  });
}
