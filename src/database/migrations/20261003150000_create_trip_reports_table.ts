import type { Knex } from "knex";

// A rider or driver reporting the other person on a trip (misconduct, safety, disputes). One live report per trip,
// reporter and category: the partial unique index lets the same issue be filed again once the last one is closed.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("tripReports", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("tripId").notNullable().references("id").inTable("trips").onDelete("CASCADE");
    table
      .uuid("reporterUserId")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table
      .uuid("reportedUserId")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table.text("reporterRole").notNullable().checkIn(["rider", "driver"]);
    table
      .text("category")
      .notNullable()
      .checkIn([
        "physicalAssault",
        "threatOrIntimidation",
        "sexualMisconduct",
        "unsafeDriving",
        "suspectedIntoxication",
        "harassment",
        "discrimination",
        "inappropriateBehavior",
        "vehicleMismatch",
        "propertyDamage",
        "fareOrPaymentDispute",
        "lateOrNoShow",
        "other",
      ]);
    table.text("severity").notNullable().checkIn(["normal", "urgent"]);
    table.text("description").notNullable();
    table.text("tripStatus").notNullable();
    table.jsonb("evidence").notNullable().defaultTo("[]");
    table
      .text("status")
      .notNullable()
      .defaultTo("open")
      .checkIn(["open", "underReview", "resolved", "dismissed", "withdrawn"]);
    table.uuid("handledByAdminId").references("userId").inTable("adminUsers").onDelete("SET NULL");
    table.text("internalNotes");
    table.text("outcomeMessage");
    table.timestamp("resolvedAt", { useTz: true });
    table.timestamp("createdAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(["reporterUserId"]);
    table.index(["reportedUserId"]);
    table.index(["tripId"]);
    table.index(["status"]);
    table.index(["createdAt"]);
  });

  await knex.raw(
    `ALTER TABLE "tripReports" ADD CONSTRAINT "tripReports_two_people" CHECK ("reporterUserId" <> "reportedUserId")`,
  );
  await knex.raw(
    `CREATE UNIQUE INDEX "tripReports_one_live_per_category" ON "tripReports" ("tripId", "reporterUserId", "category") WHERE "status" IN ('open', 'underReview')`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("tripReports");
}
