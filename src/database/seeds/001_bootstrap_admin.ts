import type { Knex } from "knex";

const ADMIN_EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@nframa.com";

export async function seed(knex: Knex): Promise<void> {
  const existingUser = await knex("users").where({ email: ADMIN_EMAIL }).first();
  if (existingUser) {
    return;
  }

  let role = await knex("roles").where({ slug: "super-admin" }).first();
  if (!role) {
    [role] = await knex("roles")
      .insert({
        slug: "super-admin",
        name: "Super Admin",
        description: "Full system access",
      })
      .returning("*");
  }

  const [user] = await knex("users")
    .insert({
      email: ADMIN_EMAIL,
      role: "admin",
    })
    .returning("*");

  await knex("adminUsers").insert({
    userId: user.id,
    roleId: role.id,
    status: "active",
  });
}
