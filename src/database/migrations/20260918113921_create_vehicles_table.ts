import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("vehicles", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("carOwnerUserId").notNullable().references("id").inTable("users");
    table.text("make").notNullable();
    table.text("model").notNullable();
    table.integer("year");
    table.text("color").notNullable();
    table.text("plate").notNullable().unique();
    table.smallint("seats").notNullable();
    table.text("status").notNullable().defaultTo("active").checkIn(["active", "retired"]);
    table.boolean("isVerified").notNullable().defaultTo(false);
    table.timestamp("verificationDate", { useTz: true });
    table.timestamp("createdAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("vehicles");
}
