import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("authSessions", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.text("userType").notNullable().checkIn(["user", "admin"]);
    table.uuid("userId").notNullable();
    table.text("refreshTokenHash").notNullable().unique();
    table.text("userAgent");
    table.specificType("ipAddress", "inet").notNullable();
    table.timestamp("lastUsedAt", { useTz: true }).notNullable();
    table.timestamp("expiresAt", { useTz: true }).notNullable();
    table.timestamp("revokedAt", { useTz: true });
    table.timestamp("createdAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("authSessions");
}
