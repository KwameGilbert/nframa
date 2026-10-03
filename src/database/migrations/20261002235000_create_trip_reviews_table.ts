import type { Knex } from "knex";

// One review per reviewer per completed trip: the rider rates the driver, the driver rates the rider.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("tripReviews", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("tripId").notNullable().references("id").inTable("trips").onDelete("CASCADE");
    table.uuid("reviewerUserId").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.uuid("revieweeUserId").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.string("reviewerRole", 10).notNullable().checkIn(["rider", "driver"]);
    table.smallint("rating").notNullable().checkBetween([1, 5]);
    table.text("comment").nullable();
    table.specificType("tags", "text[]").nullable();
    table.decimal("tip", 10, 2).notNullable().defaultTo(0);
    table.timestamp("createdAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(["tripId", "reviewerUserId"], { indexName: "uq_tripReviews_tripId_reviewerUserId" });
    table.index(["revieweeUserId"], "idx_tripReviews_revieweeUserId");
    table.index(["tripId"], "idx_tripReviews_tripId");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("tripReviews");
}
