import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("payoutMethods", (table) => {
    table.uuid("id").primary();
    table
      .uuid("paymentMethodId")
      .notNullable()
      .references("paymentMethods.id")
      .onDelete("CASCADE");
    table.uuid("driverUserId").notNullable().references("users.id").onDelete("CASCADE");
    table.boolean("isAutomatic").defaultTo(false);
    table.decimal("minimumThreshold", 12, 2).defaultTo(0);
    table.enum("payoutFrequency", ["daily", "weekly", "monthly"]).defaultTo("daily");
    table.timestamp("lastPayoutAt");
    table.timestamp("nextScheduledPayout");
    table.boolean("isPrimary").defaultTo(false);
    table.timestamp("createdAt").defaultTo(knex.fn.now()).notNullable();
    table.timestamp("updatedAt").defaultTo(knex.fn.now()).notNullable();

    table.index(["driverUserId", "isPrimary"]);
    table.index(["isAutomatic"]);
    table.index(["nextScheduledPayout"]);
    table.unique(["paymentMethodId", "driverUserId"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("payoutMethods");
}
