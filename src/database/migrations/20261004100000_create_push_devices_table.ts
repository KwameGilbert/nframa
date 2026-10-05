import type { Knex } from "knex";

// A phone or browser that can receive pushes for one user. `token` is the Expo push token (ios, android) or the
// browser's web-push endpoint URL (web, which also keeps its encryption keys in webKeys). A token belongs to one
// account at a time: registering it again moves it, which is what a shared phone needs. updatedAt is "last seen":
// the apps register again on every launch, so an old one belongs to a session that is long gone.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("pushDevices", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("userId").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.text("platform").notNullable().checkIn(["ios", "android", "web"]);
    table.text("token").notNullable().unique();
    table.jsonb("webKeys");
    table.timestamp("createdAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(["userId"]);
  });

  await knex.raw(
    `ALTER TABLE "pushDevices" ADD CONSTRAINT "pushDevices_token_length" CHECK (char_length("token") <= 2048)`,
  );
  await knex.raw(
    `ALTER TABLE "pushDevices" ADD CONSTRAINT "pushDevices_web_keys" CHECK (("platform" = 'web') = ("webKeys" IS NOT NULL))`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("pushDevices");
}
