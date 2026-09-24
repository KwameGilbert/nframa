import type { Knex } from "knex";
import { hashPassword } from "../../utils/password.js";
import { fullAccess, SUPER_ADMIN_SLUG } from "../../config/permissions.js";

// Lowercased to match emailSchema, which lowercases every email the API receives.
const ADMIN_EMAIL = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@nframa.com").toLowerCase();
const ADMIN_PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD;

// super-admin is a system role (not editable through the API) with every permission. Re-running the seed
// grants it any module added since, so it's also how to bring super-admin up to date.
async function ensureSuperAdminRole(knex: Knex) {
  let role = await knex("roles").where({ slug: SUPER_ADMIN_SLUG }).first();
  if (!role) {
    [role] = await knex("roles")
      .insert({
        slug: SUPER_ADMIN_SLUG,
        name: "Super Admin",
        description: "Full system access",
        isSystem: true,
      })
      .returning("*");
  } else if (!role.isSystem) {
    await knex("roles").where({ id: role.id }).update({ isSystem: true });
  }

  const rows = Object.keys(fullAccess()).map((module) => ({
    roleId: role.id,
    module,
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: true,
  }));
  await knex("rolePermissions")
    .insert(rows)
    .onConflict(["roleId", "module"])
    .merge(["canCreate", "canRead", "canUpdate", "canDelete"]);

  return role;
}

export async function seed(knex: Knex): Promise<void> {
  const role = await ensureSuperAdminRole(knex);

  const credentials = ADMIN_PASSWORD ? { passwordHash: await hashPassword(ADMIN_PASSWORD) } : {};

  const existingUser = await knex("users").where({ email: ADMIN_EMAIL }).first();
  if (existingUser) {
    // Lets an admin seeded before passwords existed pick one up; never overwrites a password already set.
    if (ADMIN_PASSWORD && !existingUser.passwordHash) {
      await knex("users").where({ id: existingUser.id }).update(credentials);
    }
    return;
  }

  const [user] = await knex("users")
    .insert({
      email: ADMIN_EMAIL,
      role: "admin",
      ...credentials,
    })
    .returning("*");

  await knex("adminUsers").insert({
    userId: user.id,
    roleId: role.id,
    status: "active",
  });
}
