import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("users", (table) => {
    table.text("phoneCountryCode").nullable().alter();
    table.text("phoneNumber").nullable().alter();
  });

  await knex.schema.createTable("adminUsers", (table) => {
    table.uuid("userId").primary().references("id").inTable("users");
    table.uuid("roleId").notNullable().references("id").inTable("roles").onDelete("RESTRICT");
    table.text("department");
    table
      .text("status")
      .notNullable()
      .defaultTo("invited")
      .checkIn(["active", "suspended", "invited"]);
    table.timestamp("createdAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("adminUsers");

  await knex.schema.alterTable("users", (table) => {
    table.text("phoneCountryCode").notNullable().alter();
    table.text("phoneNumber").notNullable().alter();
  });
}
