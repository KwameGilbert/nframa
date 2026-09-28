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
    // The users row existing doesn't guarantee the adminUsers row does too (e.g. it was deleted, or seeding
    // was interrupted between the two inserts below) — ensure it here rather than assuming, so re-running
    // the seed can also repair a super admin that's lost its admin record.
    const existingAdminUser = await knex("adminUsers").where({ userId: existingUser.id }).first();
    if (!existingAdminUser) {
      await knex("adminUsers").insert({
        userId: existingUser.id,
        roleId: role.id,
        status: "active",
      });
    }
    // Skip sample users if admin already exists
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

  // Sample riders
  const [rider1] = await knex("users")
    .insert({
      fullName: "Ama Mensah",
      phoneCountryCode: "+233",
      phoneNumber: "541436414",
      role: "rider",
      isPhoneVerified: true,
      status: "active",
    })
    .returning("*");

  await knex("riderProfiles").insert({
    userId: rider1.id,
  });

  const [rider2] = await knex("users")
    .insert({
      fullName: "Kwame Boateng",
      phoneCountryCode: "+233",
      phoneNumber: "501234567",
      role: "rider",
      isPhoneVerified: true,
      status: "active",
    })
    .returning("*");

  await knex("riderProfiles").insert({
    userId: rider2.id,
  });

  // Sample drivers
  const [driver1] = await knex("users")
    .insert({
      fullName: "Kofi Owusu",
      phoneCountryCode: "+233",
      phoneNumber: "541436415",
      role: "driver",
      isPhoneVerified: true,
      status: "active",
    })
    .returning("*");

  await knex("carOwnerProfiles")
    .insert({
      userId: driver1.id,
      ghanaCardNumber: "GHA-123456789-0",
      address: "12 Oxford St, Osu, Accra",
      verificationStatus: "approved",
    })
    .returning("*");

  await knex("vehicles").insert({
    carOwnerUserId: driver1.id,
    make: "Toyota",
    model: "Corolla",
    year: 2020,
    color: "Silver",
    plate: "GR 1234-21",
    seats: 4,
    status: "active",
  });

  const [driver2] = await knex("users")
    .insert({
      fullName: "Abena Amoah",
      phoneCountryCode: "+233",
      phoneNumber: "502234567",
      role: "driver",
      isPhoneVerified: true,
      status: "active",
    })
    .returning("*");

  await knex("carOwnerProfiles")
    .insert({
      userId: driver2.id,
      ghanaCardNumber: "GHA-987654321-0",
      address: "45 Independence Ave, Accra Central",
      verificationStatus: "pending",
    })
    .returning("*");

  await knex("vehicles").insert({
    carOwnerUserId: driver2.id,
    make: "Honda",
    model: "Civic",
    year: 2019,
    color: "Black",
    plate: "GR 5678-21",
    seats: 5,
    status: "active",
  });
}
