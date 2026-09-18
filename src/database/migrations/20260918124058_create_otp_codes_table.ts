import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("otpCodes", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.text("identifier").notNullable();
    table.text("channel").notNullable().checkIn(["sms", "email"]);
    table
      .text("purpose")
      .notNullable()
      .checkIn(["riderLogin", "driverLogin", "adminLogin", "passwordReset"]);
    table.text("codeHash").notNullable();
    table.timestamp("expiresAt", { useTz: true }).notNullable();
    table.timestamp("consumedAt", { useTz: true });
    table.smallint("attemptCount").notNullable().defaultTo(0);
    table.timestamp("createdAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(
      ["identifier", "purpose", "createdAt"],
      "idx_otpCodes_identifier_purpose_createdAt",
    );
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("otpCodes");
}
