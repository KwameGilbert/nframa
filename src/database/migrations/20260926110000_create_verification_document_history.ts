import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("verificationDocumentHistory", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("documentId")
      .notNullable()
      .references("id")
      .inTable("verificationDocuments")
      .onDelete("CASCADE");
    table.string("previousStatus", 20).notNullable(); // PENDING, UNDER_REVIEW, VERIFIED, REJECTED, EXPIRED, or null for initial
    table.string("newStatus", 20).notNullable(); // Current status after this change
    table.uuid("changedBy").references("id").inTable("users").onDelete("SET NULL"); // Admin or system who made the change
    table.text("notes").nullable();
    table.timestamp("changedAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("createdAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // Index for common queries
    table.index("documentId");
    table.index("changedAt");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("verificationDocumentHistory");
}
