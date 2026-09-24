import type { Knex } from "knex";
import { hashPassword } from "../../utils/password.js";

// Lowercased to match emailSchema, which lowercases every email the API receives.
const ADMIN_EMAIL = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@nframa.com").toLowerCase();
const ADMIN_PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD;

export async function seed(knex: Knex): Promise<void> {
  const credentials = ADMIN_PASSWORD ? { passwordHash: await hashPassword(ADMIN_PASSWORD) } : {};

  const existingUser = await knex("users").where({ email: ADMIN_EMAIL }).first();
  if (existingUser) {
    // Lets an admin seeded before passwords existed pick one up; never overwrites a password already set.
    if (ADMIN_PASSWORD && !existingUser.passwordHash) {
      await knex("users").where({ id: existingUser.id }).update(credentials);
    }
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
      ...credentials,
    })
    .returning("*");

  await knex("adminUsers").insert({
    userId: user.id,
    roleId: role.id,
    status: "active",
  });
}
