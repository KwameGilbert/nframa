import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
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
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("payoutHistory");
}
