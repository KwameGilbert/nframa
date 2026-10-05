import type { Knex } from "knex";

// The in-app inbox: what the apps' notification centers list. `type` has no CHECK so the catalog can grow without a
// migration (the TypeScript union in src/config/notificationTypes.ts is the guard), and `data` holds ids only.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("notifications", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("userId").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.text("type").notNullable();
    table.text("title").notNullable();
    table.text("body").notNullable();
    table.jsonb("data").notNullable().defaultTo("{}");
    table.timestamp("readAt", { useTz: true });
    table.timestamp("createdAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(
    `CREATE INDEX "notifications_user_created" ON "notifications" ("userId", "createdAt" DESC, "id" DESC)`,
  );
  await knex.raw(
    `CREATE INDEX "notifications_unread" ON "notifications" ("userId") WHERE "readAt" IS NULL`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("notifications");
}
