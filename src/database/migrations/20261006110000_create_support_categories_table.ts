import type { Knex } from "knex";

// What a support ticket is about. Admin-managed; the defaults are inserted here rather than seeded so a category an
// admin deletes stays deleted (seeds re-run, this migration runs once).
const DEFAULTS = [
  { name: "Trip issue", description: "Something went wrong on a trip.", audience: "all", defaultPriority: "normal", sortOrder: 10 },
  { name: "Payments & wallet", description: "Top-ups, charges, refunds and your wallet balance.", audience: "all", defaultPriority: "normal", sortOrder: 20 },
  { name: "Fare dispute", description: "You think a fare was wrong.", audience: "all", defaultPriority: "normal", sortOrder: 30 },
  { name: "Payouts & earnings", description: "Withdrawals, payout methods and your earnings.", audience: "driver", defaultPriority: "normal", sortOrder: 40 },
  { name: "Account & profile", description: "Signing in, your details and account settings.", audience: "all", defaultPriority: "normal", sortOrder: 50 },
  { name: "Driver verification", description: "Your documents and verification status.", audience: "driver", defaultPriority: "normal", sortOrder: 60 },
  { name: "Lost item", description: "You left something in a vehicle, or found something.", audience: "all", defaultPriority: "high", sortOrder: 70 },
  { name: "Safety concern", description: "A safety worry after a trip. If you are in danger now, use SOS in the app.", audience: "all", defaultPriority: "urgent", sortOrder: 80 },
  { name: "App problem", description: "Something in the app isn't working.", audience: "all", defaultPriority: "low", sortOrder: 90 },
  { name: "Other", description: "Anything else.", audience: "all", defaultPriority: "normal", sortOrder: 999 },
];

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("supportCategories", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.text("name").notNullable();
    table.text("description");
    table.text("audience").notNullable().defaultTo("all").checkIn(["all", "rider", "driver"]);
    table
      .text("defaultPriority")
      .notNullable()
      .defaultTo("normal")
      .checkIn(["low", "normal", "high", "urgent"]);
    table.boolean("isActive").notNullable().defaultTo(true);
    table.integer("sortOrder").notNullable().defaultTo(0);
    table.timestamp("createdAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(
    `CREATE UNIQUE INDEX "supportCategories_name_unique" ON "supportCategories" (lower("name"))`,
  );
  await knex("supportCategories").insert(DEFAULTS);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("supportCategories");
}
