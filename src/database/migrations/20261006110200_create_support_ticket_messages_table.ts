import type { Knex } from "knex";

// A ticket's timeline: public messages, staff-only notes and status/assignment events, ordered by seq. seq is
// what orders, pages and marks things read: a message and the event it causes share now() in one transaction,
// and JS Dates drop microseconds. Every insert holds the ticket's row lock, so seq follows commit order per ticket.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("supportTicketMessages", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("ticketId")
      .notNullable()
      .references("id")
      .inTable("supportTickets")
      .onDelete("CASCADE");
    table.uuid("senderUserId").references("id").inTable("users").onDelete("SET NULL");
    table.text("senderSide").notNullable().checkIn(["user", "staff", "system"]);
    table.text("kind").notNullable().checkIn(["message", "note", "event"]);
    table.boolean("internal").notNullable().defaultTo(false);
    table.text("body");
    table.jsonb("attachments").notNullable().defaultTo("[]");
    table
      .uuid("replyToMessageId")
      .references("id")
      .inTable("supportTicketMessages")
      .onDelete("SET NULL");
    table
      .text("eventType")
      .checkIn(["opened", "statusChanged", "assigned", "unassigned", "detailsChanged", "rated"]);
    table.jsonb("eventData");
    // A deleted message keeps its body and files: staff still see them as evidence.
    table.timestamp("deletedAt", { useTz: true });
    table.uuid("deletedByUserId").references("id").inTable("users").onDelete("SET NULL");
    table.text("deletedBySide").checkIn(["user", "staff"]);
    table.timestamp("createdAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(["senderUserId"]);
  });

  await knex.raw(`
    ALTER TABLE "supportTicketMessages"
      ADD COLUMN "seq" integer GENERATED ALWAYS AS IDENTITY,
      ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce("body", ''))) STORED,
      ADD CONSTRAINT "supportTicketMessages_event_type" CHECK (("kind" = 'event') = ("eventType" IS NOT NULL)),
      ADD CONSTRAINT "supportTicketMessages_note_internal" CHECK ("kind" = 'event' OR "internal" = ("kind" = 'note')),
      ADD CONSTRAINT "supportTicketMessages_note_staff" CHECK ("kind" <> 'note' OR "senderSide" = 'staff'),
      ADD CONSTRAINT "supportTicketMessages_body_length" CHECK (char_length("body") <= 4000),
      ADD CONSTRAINT "supportTicketMessages_has_content" CHECK (
        "kind" = 'event' OR "body" IS NOT NULL OR jsonb_array_length("attachments") > 0
      ),
      ADD CONSTRAINT "supportTicketMessages_deleted_pair" CHECK (("deletedAt" IS NULL) = ("deletedBySide" IS NULL))
  `);
  await knex.raw(
    `CREATE UNIQUE INDEX "supportTicketMessages_ticket_seq" ON "supportTicketMessages" ("ticketId", "seq")`,
  );
  await knex.raw(
    `CREATE INDEX "supportTicketMessages_search" ON "supportTicketMessages" USING GIN ("searchVector")`,
  );
  await knex.raw(
    `CREATE INDEX "supportTicketMessages_reply_to" ON "supportTicketMessages" ("replyToMessageId") WHERE "replyToMessageId" IS NOT NULL`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("supportTicketMessages");
}
