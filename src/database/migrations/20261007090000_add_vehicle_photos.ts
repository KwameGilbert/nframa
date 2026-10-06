import type { Knex } from "knex";

// Four photos of each vehicle, one per side. photos holds the public URLs (returned by the API); photoKeys the
// storage keys, which never leave the server. Both are objects keyed by side, and only these sides are allowed.
// Vehicles registered before this have none; new ones must send all four (enforced by the API).
const SIDES = `ARRAY['front', 'back', 'left', 'right']`;

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("vehicles", (table) => {
    table.jsonb("photos").notNullable().defaultTo("{}");
    table.jsonb("photoKeys").notNullable().defaultTo("{}");
  });
  await knex.raw(`
    ALTER TABLE "vehicles"
      ADD CONSTRAINT "vehicles_photos_sides" CHECK (jsonb_typeof("photos") = 'object' AND "photos" - ${SIDES} = '{}'::jsonb),
      ADD CONSTRAINT "vehicles_photo_keys_sides" CHECK (jsonb_typeof("photoKeys") = 'object' AND "photoKeys" - ${SIDES} = '{}'::jsonb)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("vehicles", (table) => {
    table.dropColumn("photos");
    table.dropColumn("photoKeys");
  });
}
