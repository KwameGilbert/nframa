import type { Knex } from "knex";

// A snapshot, not an import of src/config/permissions.ts — a migration must keep doing what it did when it
// was written, even after the app's module list changes.
const MODULE = "activityLogs";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("activityLogs", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    // Null when nobody was signed in (e.g. a failed login). Users are soft-deleted, so this rarely nulls.
    table.uuid("actorId").nullable().references("id").inTable("users").onDelete("SET NULL");
    table.string("module", 40).notNullable();
    table.string("action", 80).notNullable();
    table.text("description").notNullable();
    table.string("targetType", 40).nullable();
    table.text("targetId").nullable(); // text, not uuid: some targets are keyed otherwise (settings by key)
    table.string("result", 10).notNullable().checkIn(["success", "failure"]);
    table.integer("statusCode").notNullable();
    table.text("errorMessage").nullable();
    table.string("method", 10).notNullable();
    table.text("path").notNullable();
    table.jsonb("requestBody").nullable();
    table.jsonb("before").nullable();
    table.jsonb("after").nullable();
    table.specificType("changedFields", "text[]").nullable();
    table.string("ipAddress", 64).nullable();
    table.text("userAgent").nullable();
    table.text("requestId").nullable();
    table.integer("durationMs").notNullable();
    table.timestamp("createdAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index("createdAt");
    table.index(["actorId", "createdAt"]);
    table.index(["module", "createdAt"]);
    table.index(["targetType", "targetId"]);
    table.index("requestId");
  });

  const superAdmin = await knex("roles").where({ slug: "superadmin" }).first();
  if (superAdmin) {
    await knex("rolePermissions")
      .insert({
        roleId: superAdmin.id,
        module: MODULE,
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: true,
      })
      .onConflict(["roleId", "module"])
      .ignore();
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex("rolePermissions").where({ module: MODULE }).del();
  await knex.schema.dropTableIfExists("activityLogs");
}
