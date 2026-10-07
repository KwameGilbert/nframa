import type { Knex } from "knex";

// Super-admin (the system role) gets every action on the new overview and finance modules.
export async function up(knex: Knex) {
  await knex.raw(`
    INSERT INTO "rolePermissions" ("roleId", "module", "canCreate", "canRead", "canUpdate", "canDelete")
    SELECT "id", m.module, true, true, true, true
    FROM "roles", (VALUES ('overview'), ('finance')) AS m(module)
    WHERE "isSystem" = true
    ON CONFLICT ("roleId", "module") DO NOTHING
  `);
}

export async function down(knex: Knex) {
  await knex("rolePermissions").whereIn("module", ["overview", "finance"]).del();
}
