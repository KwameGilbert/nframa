import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("paymentMethods", (table) => {
    table.uuid("id").primary();
    table.uuid("userId").notNullable().references("users.id").onDelete("CASCADE");
    table.enum("userRole", ["rider", "driver"]).notNullable();
    table.enum("type", ["card", "mobile_money", "bank_account"]).notNullable();
    table.enum("provider", ["hubtel", "paystack"]).notNullable();
    table.string("tokenizedReference", 500).notNullable();
    table.string("displayName", 50).notNullable();
    table.boolean("isVerified").defaultTo(false);
    table.enum("verificationStatus", ["pending", "verified", "failed"]).defaultTo("pending");
    table.string("verificationToken", 255);
    table.integer("verificationAttempts").defaultTo(0);
    table.timestamp("verificationFailedAt");
    table.timestamp("verificationCompletedAt");
    table.boolean("isActive").defaultTo(true);
    table.boolean("isPrimary").defaultTo(false);
    table.jsonb("metadata").defaultTo("{}");
    table.timestamp("createdAt").defaultTo(knex.fn.now()).notNullable();
    table.timestamp("updatedAt").defaultTo(knex.fn.now()).notNullable();

    table.index(["userId", "isActive"]);
    table.index(["userId", "isPrimary"]);
    table.index(["isVerified"]);
    table.unique(["userId", "tokenizedReference"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("paymentMethods");
}
