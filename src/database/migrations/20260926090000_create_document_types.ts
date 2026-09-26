import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("documentTypes", (table) => {
    table.increments("id").primary();
    table.string("code", 50).unique().notNullable();
    table.string("name", 100).notNullable();
    table.text("description");
    table.boolean("hasExpiry").defaultTo(false);
    table.timestamp("createdAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex("documentTypes").insert([
    {
      code: "NATIONAL_ID",
      name: "National ID",
      description: "Government-issued national identification document",
      hasExpiry: true,
    },
    {
      code: "DRIVERS_LICENSE",
      name: "Driver's License",
      description: "Valid driver's license from relevant authority",
      hasExpiry: true,
    },
    {
      code: "VEHICLE_REGISTRATION",
      name: "Vehicle Registration",
      description: "Vehicle registration certificate",
      hasExpiry: true,
    },
    {
      code: "INSURANCE",
      name: "Insurance Certificate",
      description: "Current vehicle insurance proof",
      hasExpiry: true,
    },
    {
      code: "ROADWORTHINESS",
      name: "Roadworthiness Certificate",
      description: "Vehicle roadworthiness certificate",
      hasExpiry: false,
    },
  ]);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("documentTypes");
}
