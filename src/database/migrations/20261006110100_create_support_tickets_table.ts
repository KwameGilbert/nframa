import type { Knex } from "knex";

// A rider's or driver's support ticket. The status machine lives in supportTicket.model; the CHECKs here hold the
// invariants it relies on. Read markers are message seqs, not timestamps (see supportTicketMessages).
export async function up(knex: Knex): Promise<void> {
  // For word_similarity in staff search. Left in place on rollback: other objects may come to use it.
  await knex.raw(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

  await knex.schema.createTable("supportTickets", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.text("code").notNullable();
    table.uuid("userId").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.text("raiserRole").notNullable().checkIn(["rider", "driver"]);
    table
      .uuid("categoryId")
      .notNullable()
      .references("id")
      .inTable("supportCategories")
      .onDelete("RESTRICT");
    table.text("subject").notNullable();
    table.text("priority").notNullable().checkIn(["low", "normal", "high", "urgent"]);
    table
      .text("status")
      .notNullable()
      .defaultTo("open")
      .checkIn(["open", "inProgress", "awaitingUser", "resolved", "closed"]);
    table.uuid("assignedAdminId").references("userId").inTable("adminUsers").onDelete("SET NULL");
    table.uuid("createdByAdminId").references("userId").inTable("adminUsers").onDelete("SET NULL");
    table.timestamp("assignedAt", { useTz: true });
    table.uuid("tripId").references("id").inTable("trips").onDelete("SET NULL");
    table.uuid("transactionId").references("id").inTable("transactions").onDelete("SET NULL");
    table.uuid("payoutId").references("id").inTable("payoutHistory").onDelete("SET NULL");
    table.uuid("relatedTicketId").references("id").inTable("supportTickets").onDelete("SET NULL");
    table.timestamp("firstResponseAt", { useTz: true });
    table.timestamp("lastMessageAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.text("lastMessageSide").checkIn(["user", "staff"]);
    table.integer("userLastReadSeq");
    table.integer("staffLastReadSeq");
    table.timestamp("resolvedAt", { useTz: true });
    table.timestamp("closedAt", { useTz: true });
    table.smallint("rating");
    table.text("ratingComment");
    table.timestamp("ratedAt", { useTz: true });
    // Set when the account's phone number is recycled to a new person: the new owner never sees these tickets.
    table.timestamp("detachedAt", { useTz: true });
    table.timestamp("createdAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(["code"], { indexName: "supportTickets_code_unique" });
    table.index(["userId"]);
    table.index(["categoryId"]);
    table.index(["assignedAdminId"]);
    table.index(["createdByAdminId"]);
    table.index(["tripId"]);
    table.index(["transactionId"]);
    table.index(["payoutId"]);
    table.index(["relatedTicketId"]);
  });

  await knex.raw(`
    ALTER TABLE "supportTickets"
      ADD CONSTRAINT "supportTickets_rating_range" CHECK ("rating" BETWEEN 1 AND 5),
      ADD CONSTRAINT "supportTickets_rating_pair" CHECK (("rating" IS NULL) = ("ratedAt" IS NULL)),
      ADD CONSTRAINT "supportTickets_resolved_at" CHECK ("status" <> 'resolved' OR "resolvedAt" IS NOT NULL),
      ADD CONSTRAINT "supportTickets_closed_at" CHECK ("status" <> 'closed' OR "closedAt" IS NOT NULL),
      ADD CONSTRAINT "supportTickets_subject_length" CHECK (char_length("subject") BETWEEN 1 AND 120),
      ADD CONSTRAINT "supportTickets_comment_length" CHECK (char_length("ratingComment") <= 1000)
  `);
  // The two lazy sweeps: idle awaitingUser tickets auto-resolve, expired resolved tickets close.
  await knex.raw(
    `CREATE INDEX "supportTickets_resolved_sweep" ON "supportTickets" ("resolvedAt") WHERE "status" = 'resolved'`,
  );
  await knex.raw(
    `CREATE INDEX "supportTickets_awaiting_sweep" ON "supportTickets" ("lastMessageAt") WHERE "status" = 'awaitingUser'`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("supportTickets");
}
