import type { Knex } from "knex";

// Emails are lowercased on input from now on (see emailSchema); lowercase existing rows too, or accounts
// stored with capitals could never be matched again. Fails on the email unique constraint if two accounts
// differ only by case — those need merging by hand first.
export async function up(knex: Knex): Promise<void> {
  await knex("users")
    .whereRaw('"email" <> lower("email")')
    .update({ email: knex.raw('lower("email")') });
}

export async function down(): Promise<void> {
  // The original casing isn't recorded, so there's nothing to restore.
}
