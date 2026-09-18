import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

  await knex.schema.createTable("users", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.text("fullName");
    table.text("email").unique();
    table.text("phoneCountryCode").notNullable();
    table.text("phoneNumber").notNullable();
    table.date("dateOfBirth");
    table.text("passwordHash");
    table.text("passwordSalt");
    table.text("status").notNullable().defaultTo("active").checkIn(["active", "suspended"]);
    table.text("profilePicture");
    table.text("oauthProvider").checkIn(["google", "facebook", "apple"]);
    table.text("role").notNullable().checkIn(["rider", "driver", "admin"]);
    table.boolean("isPhoneVerified").notNullable().defaultTo(false);
    table.boolean("isEmailVerified").notNullable().defaultTo(false);
    table.boolean("isProfileComplete").notNullable().defaultTo(false);
    table.timestamp("lastActiveAt", { useTz: true });
    table.timestamp("createdAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("deletedAt", { useTz: true });

    table.unique(["phoneCountryCode", "phoneNumber"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("users");
}
