import type { Knex } from "knex";
import { TRIP_SETTINGS } from "../../config/tripSettings.js";

// Idempotent: a setting an admin has already created or changed is left alone.
export async function seed(knex: Knex): Promise<void> {
  const rows = Object.entries(TRIP_SETTINGS).map(
    ([key, { type, default: value, description }]) => ({
      key,
      type,
      value: JSON.stringify(value),
      description,
    }),
  );

  await knex("settings").insert(rows).onConflict("key").ignore();
}
