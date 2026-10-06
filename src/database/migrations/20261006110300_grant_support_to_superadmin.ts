import type { Knex } from "knex";

// A new permission module: only the system super-admin role gets it automatically. Other roles are given it
// through the roles API when someone should work the support desk.
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    INSERT INTO "rolePermissions" ("roleId", "module", "canCreate", "canRead", "canUpdate", "canDelete")
    SELECT "id", 'support', true, true, true, true FROM "roles" WHERE "isSystem" = true
    ON CONFLICT ("roleId", "module") DO NOTHING
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex("rolePermissions").where({ module: "support" }).del();
}
