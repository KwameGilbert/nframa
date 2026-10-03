import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("sosIncidents", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("userId").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.uuid("tripId").references("id").inTable("trips").onDelete("SET NULL");
    table.text("role").notNullable().checkIn(["rider", "driver"]);
    table
      .text("status")
      .notNullable()
      .defaultTo("triggered")
      .checkIn(["triggered", "underReview", "servicesContacted", "resolved", "cancelledByUser"]);
    table.decimal("latitude", 9, 6).notNullable();
    table.decimal("longitude", 9, 6).notNullable();
    table.text("address");
    table.text("reason");
    table.jsonb("emergencyContactsSnapshot");
    table.uuid("resolvedByAdminId").references("userId").inTable("adminUsers").onDelete("SET NULL");
    table.text("resolutionNotes");
    table.timestamp("resolvedAt", { useTz: true });
    table.timestamp("createdAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(["userId"]);
    table.index(["tripId"]);
    table.index(["status"]);
    table.index(["createdAt"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("sosIncidents");
}
