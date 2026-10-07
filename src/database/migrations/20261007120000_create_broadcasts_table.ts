import type { Knex } from "knex";

// Platform-wide announcements staff compose in the Broadcast Studio and send now or at a set time, to riders,
// drivers or everyone, over any of in-app, push, SMS and email. A draft or scheduled one can still be edited; a
// scheduled one can be cancelled. sending/sent/failed are the delivery worker's, and final.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("broadcasts", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.text("title").notNullable();
    table.text("body").notNullable();
    // What an SMS says instead of "title: body", when set.
    table.text("smsText");
    table.text("audience").notNullable().checkIn(["riders", "drivers", "all"]);
    table.specificType("channels", "text[]").notNullable();
    table
      .text("status")
      .notNullable()
      .defaultTo("draft")
      .checkIn(["draft", "scheduled", "sending", "sent", "cancelled", "failed"]);
    table.timestamp("scheduledFor", { useTz: true });
    table.timestamp("startedAt", { useTz: true });
    table.timestamp("sentAt", { useTz: true });
    table.timestamp("cancelledAt", { useTz: true });
    // Staff are soft-deleted, so these normally stay set; SET NULL only so a hard delete can't be blocked.
    table.uuid("createdBy").references("id").inTable("users").onDelete("SET NULL");
    table.uuid("updatedBy").references("id").inTable("users").onDelete("SET NULL");
    table.uuid("cancelledBy").references("id").inTable("users").onDelete("SET NULL");
    table.timestamp("createdAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.check(
      `cardinality("channels") > 0 AND "channels" <@ ARRAY['inApp', 'push', 'sms', 'email']::text[]`,
      [],
      "chk_broadcasts_channels",
    );
    table.check(
      `"status" <> 'scheduled' OR "scheduledFor" IS NOT NULL`,
      [],
      "chk_broadcasts_scheduledFor",
    );
    // The delivery worker's lookup: scheduled ones that are due.
    table.index(["status", "scheduledFor"], "idx_broadcasts_status_scheduledFor");
    table.index(["createdAt"], "idx_broadcasts_createdAt");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("broadcasts");
}
