import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("verificationDocuments", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("userId").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.integer("documentTypeId").notNullable().references("id").inTable("documentTypes");
    table.string("fileUrl", 2048).notNullable(); // Public URL the document can be viewed at
    // Storage-specific identifier for deletion: a relative path (local) or public_id (Cloudinary). Never
    // returned to clients — see VerificationDocumentModel.excludedColumns.
    table.string("storageKey", 2048).notNullable();
    // Which service holds the file, since a document uploaded under one STORAGE_DRIVER stays retrievable
    // by that driver even if the env var is later switched to the other one.
    table.string("storageDriver", 20).notNullable();
    table.string("status", 20).notNullable().defaultTo("PENDING"); // PENDING, UNDER_REVIEW, VERIFIED, REJECTED, EXPIRED
    table.timestamp("expiresAt", { useTz: true }); // NULL if doc doesn't expire
    table.text("notes"); // Admin rejection reason, pending notes, etc.
    table.timestamp("uploadedAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("verifiedAt", { useTz: true }); // When status changed to VERIFIED
    table.uuid("verifiedBy").references("id").inTable("users").onDelete("SET NULL");
    table.timestamp("createdAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // One of each document type per driver
    table.unique(["userId", "documentTypeId"]);
  });

  // Index for common queries
  await knex.schema.raw(
    `CREATE INDEX idx_verification_documents_status ON "verificationDocuments"("status")`,
  );
  await knex.schema.raw(
    `CREATE INDEX idx_verification_documents_userId ON "verificationDocuments"("userId")`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("verificationDocuments");
}
