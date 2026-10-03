import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  const superAdminRole = await knex("roles")
    .where({ slug: "superadmin", isSystem: true })
    .select("id")
    .first();

  if (superAdminRole) {
    await knex("rolePermissions").insert([
      {
        roleId: superAdminRole.id,
        module: "payouts",
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: false,
      },
    ]);
  }
}

export async function down(knex: Knex): Promise<void> {
  const superAdminRole = await knex("roles")
    .where({ slug: "superadmin", isSystem: true })
    .select("id")
    .first();

  if (superAdminRole) {
    await knex("rolePermissions")
      .where({ roleId: superAdminRole.id, module: "payouts" })
      .delete();
  }
}
