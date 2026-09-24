import type { Knex } from "knex";

// A snapshot, not an import of src/config/permissions.ts — a migration must keep doing what it did when it
// was written, even after the app's module list changes.
const MODULES = ["settings", "roles", "users"];

export async function up(knex: Knex): Promise<void> {
  // System roles (super-admin) can't be edited or deleted through the API.
  await knex.schema.alterTable("roles", (table) => {
    table.boolean("isSystem").notNullable().defaultTo(false);
  });
  await knex("roles").where({ slug: "superadmin" }).update({ isSystem: true });

  // The old table held free-form JSON that nothing read. Kept under a new name rather than dropped so no
  // data is lost — drop "rolePermissionsLegacy" once you've confirmed nothing in it is needed.
  await knex.schema.renameTable("rolePermissions", "rolePermissionsLegacy");

  await knex.schema.createTable("rolePermissions", (table) => {
    table.uuid("roleId").notNullable().references("id").inTable("roles").onDelete("CASCADE");
    table.text("module").notNullable();
    table.boolean("canCreate").notNullable().defaultTo(false);
    table.boolean("canRead").notNullable().defaultTo(false);
    table.boolean("canUpdate").notNullable().defaultTo(false);
    table.boolean("canDelete").notNullable().defaultTo(false);
    table.timestamp("createdAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // Named explicitly: the renamed legacy table still owns the default "rolePermissions_pkey" name.
    table.primary(["roleId", "module"], { constraintName: "rolePermissions_roleId_module_pkey" });
  });

  const superAdmin = await knex("roles").where({ slug: "superadmin" }).first();
  if (superAdmin) {
    await knex("rolePermissions").insert(
      MODULES.map((module) => ({
        roleId: superAdmin.id,
        module,
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: true,
      })),
    );
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("rolePermissions");
  await knex.schema.renameTable("rolePermissionsLegacy", "rolePermissions");
  await knex.schema.alterTable("roles", (table) => {
    table.dropColumn("isSystem");
  });
}
