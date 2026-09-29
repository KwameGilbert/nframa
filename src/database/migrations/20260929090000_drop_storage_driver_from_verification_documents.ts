import type { Knex } from "knex";

// storageDriver tracked which backend (local disk vs Cloudinary) held a file, so it could be deleted
// correctly regardless of which one was active at upload time. The local driver was never implemented —
// every upload has only ever gone through Cloudinary — so the column had a single constant value and
// nothing left to disambiguate.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.table("verificationDocuments", (table) => {
    table.dropColumn("storageDriver");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.table("verificationDocuments", (table) => {
    table.string("storageDriver", 20).notNullable().defaultTo("cloudinary");
  });
}
