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

// Creates a rider/driver by phone (skipping if that number already has an account — this seed can be
// re-run against a database that already has some but not all of its sample data, e.g. after a partial
// prior run) and returns the user row either way.
async function ensurePhoneUser(
  knex: Knex,
  fields: {
    fullName: string;
    phoneCountryCode: string;
    phoneNumber: string;
    role: "rider" | "driver";
  },
) {
  const existing = await knex("users")
    .where({ phoneCountryCode: fields.phoneCountryCode, phoneNumber: fields.phoneNumber })
    .first();
  if (existing) {
    return existing;
  }

  const [user] = await knex("users")
    .insert({ ...fields, isPhoneVerified: true, status: "active" })
    .returning("*");
  return user;
}

async function ensureSampleRider(knex: Knex, fields: Parameters<typeof ensurePhoneUser>[1]) {
  const user = await ensurePhoneUser(knex, fields);
  const hasProfile = await knex("riderProfiles").where({ userId: user.id }).first();
  if (!hasProfile) {
    await knex("riderProfiles").insert({ userId: user.id });
  }
}

async function ensureSampleDriver(
  knex: Knex,
  fields: Parameters<typeof ensurePhoneUser>[1],
  profile: { code: string; ghanaCardNumber: string; address: string; verificationStatus: string },
  vehicle: {
    make: string;
    model: string;
    year: number;
    color: string;
    plate: string;
    seats: number;
  },
) {
  const user = await ensurePhoneUser(knex, fields);

  const hasProfile = await knex("carOwnerProfiles").where({ userId: user.id }).first();
  if (!hasProfile) {
    await knex("carOwnerProfiles").insert({ userId: user.id, ...profile });
  }

  const hasVehicle = await knex("vehicles").where({ plate: vehicle.plate }).first();
  if (!hasVehicle) {
    await knex("vehicles").insert({ carOwnerUserId: user.id, ...vehicle, status: "active" });
  }
}

export async function seed(knex: Knex): Promise<void> {
  const role = await ensureSuperAdminRole(knex);

  const credentials = ADMIN_PASSWORD ? { passwordHash: await hashPassword(ADMIN_PASSWORD) } : {};

  let adminUser = await knex("users").where({ email: ADMIN_EMAIL }).first();
  if (adminUser) {
    // Lets an admin seeded before passwords existed pick one up; never overwrites a password already set.
    if (ADMIN_PASSWORD && !adminUser.passwordHash) {
      await knex("users").where({ id: adminUser.id }).update(credentials);
    }
  } else {
    [adminUser] = await knex("users")
      .insert({ email: ADMIN_EMAIL, role: "admin", ...credentials })
      .returning("*");
  }

  // The users row existing doesn't guarantee the adminUsers row does too (e.g. it was deleted, or seeding
  // was interrupted between the two inserts) — ensure it here rather than assuming, so re-running the seed
  // can also repair a super admin that's lost its admin record.
  const existingAdminUser = await knex("adminUsers").where({ userId: adminUser.id }).first();
  if (!existingAdminUser) {
    await knex("adminUsers").insert({ userId: adminUser.id, roleId: role.id, status: "active" });
  }

  // Sample riders and drivers, for local/manual testing — each step is independently idempotent so this
  // seed is always safe to re-run, regardless of what a previous run already created.
  await ensureSampleRider(knex, {
    fullName: "Ama Mensah",
    phoneCountryCode: "+233",
    phoneNumber: "541436414",
    role: "rider",
  });
  await ensureSampleRider(knex, {
    fullName: "Kwame Boateng",
    phoneCountryCode: "+233",
    phoneNumber: "501234567",
    role: "rider",
  });

  await ensureSampleDriver(
    knex,
    { fullName: "Kofi Owusu", phoneCountryCode: "+233", phoneNumber: "541436415", role: "driver" },
    {
      code: "DR-SAMPLE1",
      ghanaCardNumber: "GHA-123456789-0",
      address: "12 Oxford St, Osu, Accra",
      verificationStatus: "approved",
    },
    {
      make: "Toyota",
      model: "Corolla",
      year: 2020,
      color: "Silver",
      plate: "GR 1234-21",
      seats: 4,
    },
  );
  await ensureSampleDriver(
    knex,
    { fullName: "Abena Amoah", phoneCountryCode: "+233", phoneNumber: "502234567", role: "driver" },
    {
      code: "DR-SAMPLE2",
      ghanaCardNumber: "GHA-987654321-0",
      address: "45 Independence Ave, Accra Central",
      verificationStatus: "pending",
    },
    { make: "Honda", model: "Civic", year: 2019, color: "Black", plate: "GR 5678-21", seats: 5 },
  );
}
