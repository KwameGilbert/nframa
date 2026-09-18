import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("carOwnerProfiles", (table) => {
    table.uuid("userId").primary().references("id").inTable("users");
    table.text("code").notNullable().unique();
    table
      .text("verificationStatus")
      .notNullable()
      .defaultTo("unverified")
      .checkIn(["unverified", "pending", "approved", "rejected", "expiring"]);
    table.text("ghanaCardNumber");
    table.text("address");
    table.boolean("isOnline").notNullable().defaultTo(false);
    table.boolean("autoAcceptBookings").notNullable().defaultTo(false);
    table.timestamp("termsAcceptedAt", { useTz: true });
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("carOwnerProfiles");
}
