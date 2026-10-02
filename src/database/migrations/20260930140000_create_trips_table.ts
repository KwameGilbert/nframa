import type { Knex } from "knex";

// A rider's seat on one day's run of a driver's commute. driverUserId is copied from the commute so the
// driver's lists need no join. Money is held on accept (heldAmount) and charged at boarding.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("trips", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("commuteId")
      .notNullable()
      .references("id")
      .inTable("driverCommutes")
      .onDelete("RESTRICT");
    table.uuid("riderUserId").notNullable().references("id").inTable("users").onDelete("RESTRICT");
    table.uuid("driverUserId").notNullable().references("id").inTable("users").onDelete("RESTRICT");
    table.date("tripDate").notNullable();
    table
      .text("status")
      .notNullable()
      .defaultTo("pending")
      .checkIn([
        "pending",
        "accepted",
        "declined",
        "cancelled",
        "boarded",
        "completed",
        "no_show",
        "expired",
      ]);

    table.text("pickupAddress").notNullable();
    table.decimal("pickupLat", 9, 6).notNullable();
    table.decimal("pickupLng", 9, 6).notNullable();
    table.text("dropoffAddress").notNullable();
    table.decimal("dropoffLat", 9, 6).notNullable();
    table.decimal("dropoffLng", 9, 6).notNullable();
    // Position along the commute's start-to-end line (0..1), stored so stops sort without recomputing.
    table.decimal("pickupProgress", 5, 4).notNullable();
    table.decimal("dropoffProgress", 5, 4).notNullable();
    table.integer("distanceMeters").notNullable();
    table.integer("durationSeconds").notNullable();
    table.timestamp("scheduledPickupAt").notNullable();
    table.timestamp("scheduledDropoffAt").notNullable();
    table.timestamp("expiresAt").nullable(); // set only while pending

    table.decimal("fare", 12, 2).notNullable();
    table.decimal("platformFee", 12, 2).notNullable();
    table.decimal("bookingFee", 12, 2).notNullable();
    table.decimal("totalAmount", 12, 2).notNullable();
    table.decimal("driverEarnings", 12, 2).notNullable();
    table.decimal("waitCharge", 12, 2).notNullable().defaultTo(0);
    table.decimal("heldAmount", 12, 2).notNullable().defaultTo(0);
    table.jsonb("fareBreakdown").notNullable();

    table.text("boardingCode").notNullable().unique();
    table.decimal("riderLat", 9, 6).nullable();
    table.decimal("riderLng", 9, 6).nullable();
    table.timestamp("riderLocationAt").nullable();
    table.timestamp("arrivedAt").nullable();
    table.timestamp("boardedAt").nullable();
    table.decimal("boardingLat", 9, 6).nullable();
    table.decimal("boardingLng", 9, 6).nullable();
    table.integer("waitMinutes").nullable();
    table.timestamp("acceptedAt").nullable();
    table.timestamp("completedAt").nullable();
    table.timestamp("cancelledAt").nullable();
    table.text("cancelledBy").nullable().checkIn(["rider", "driver", "system", "admin"]);
    table.text("cancellationReason").nullable();
    table.timestamp("createdAt").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updatedAt").notNullable().defaultTo(knex.fn.now());

    table.check(
      `"pickupProgress" >= 0 AND "pickupProgress" < "dropoffProgress" AND "dropoffProgress" <= 1`,
      [],
      "trips_progress_check",
    );
    table.check(
      `"fare" >= 0 AND "platformFee" >= 0 AND "bookingFee" >= 0 AND "totalAmount" >= 0 AND "driverEarnings" >= 0 AND "waitCharge" >= 0 AND "heldAmount" >= 0`,
      [],
      "trips_money_check",
    );

    table.index(["commuteId", "tripDate", "status"]);
    table.index(["riderUserId", "scheduledPickupAt"]);
    table.index(["driverUserId", "tripDate"]);
  });

  // One active seat per rider per commute run; a cancelled or declined request doesn't block a new one.
  await knex.raw(
    `CREATE UNIQUE INDEX "trips_one_active_per_rider" ON "trips" ("riderUserId", "commuteId", "tripDate") WHERE "status" IN ('pending', 'accepted', 'boarded')`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("trips");
}
