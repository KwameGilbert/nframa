import type { Knex } from "knex";

// Google and Apple sign-up creates rider/driver accounts without a phone number (the columns have been nullable
// since admins, who have none, were added) — but a phone is never half set. Linked sign-ins get their own
// table, since one account can link both providers; the single users.oauthProvider slot (never set by
// anything) goes.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("users", (table) => {
    table.dropColumn("oauthProvider");
    table.check(
      '("phoneCountryCode" IS NULL) = ("phoneNumber" IS NULL)',
      [],
      "chk_users_phoneComplete",
    );
  });

  await knex.schema.createTable("socialAccounts", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("userId").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.text("provider").notNullable().checkIn(["google", "apple"]);
    // The provider's stable id for the person (the token's `sub`) — emails can change, this can't.
    table.text("providerUserId").notNullable();
    table.text("email");
    table.timestamp("createdAt", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(["provider", "providerUserId"], {
      indexName: "uq_socialAccounts_provider_providerUserId",
    });
    table.unique(["userId", "provider"], { indexName: "uq_socialAccounts_userId_provider" });
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("socialAccounts");
  await knex.schema.alterTable("users", (table) => {
    table.dropChecks("chk_users_phoneComplete");
    table.text("oauthProvider").checkIn(["google", "facebook", "apple"]);
  });
}
