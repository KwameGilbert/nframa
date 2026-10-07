import type { Knex } from "knex";

// An account that signed up with Google or Apple adds its phone number with a code sent to it (POST
// /auth/phone/otp + /auth/phone/verify): its own purpose, so a sign-in code can't be used to add a number.
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE "otpCodes" DROP CONSTRAINT IF EXISTS "otpCodes_purpose_check";
    ALTER TABLE "otpCodes" ADD CONSTRAINT "otpCodes_purpose_check" CHECK ("purpose" IN ('riderLogin', 'driverLogin', 'adminLogin', 'passwordReset', 'addPhone'));
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DELETE FROM "otpCodes" WHERE "purpose" = 'addPhone';
    ALTER TABLE "otpCodes" DROP CONSTRAINT IF EXISTS "otpCodes_purpose_check";
    ALTER TABLE "otpCodes" ADD CONSTRAINT "otpCodes_purpose_check" CHECK ("purpose" IN ('riderLogin', 'driverLogin', 'adminLogin', 'passwordReset'));
  `);
}
