import type { Knex } from "knex";

// SOS gets its own permission module instead of riding on "users". Everyone who could use the safety desk through
// "users" keeps exactly that access, now granted under "sos"; from here on the two are managed separately.
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    INSERT INTO "rolePermissions" ("roleId", "module", "canCreate", "canRead", "canUpdate", "canDelete")
    SELECT "roleId", 'sos', "canCreate", "canRead", "canUpdate", "canDelete"
    FROM "rolePermissions"
    WHERE "module" = 'users'
    ON CONFLICT ("roleId", "module") DO NOTHING
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex("rolePermissions").where({ module: "sos" }).del();
}
