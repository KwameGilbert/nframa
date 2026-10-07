import type { Knex } from "knex";
import db from "../database/knex.js";
import { BaseModel } from "./BaseModel.js";
import type { SocialIdentity, SocialProvider } from "../services/socialAuth.service.js";

export interface SocialAccount {
  id: string;
  userId: string;
  provider: SocialProvider;
  providerUserId: string;
  email: string | null;
  createdAt: Date;
}

class SocialAccountModel extends BaseModel<SocialAccount> {
  protected readonly tableName = "socialAccounts";

  findByIdentity(identity: SocialIdentity) {
    return this.findOne({ provider: identity.provider, providerUserId: identity.providerUserId });
  }

  // Inside a sign-up transaction, so a clash (a concurrent sign-up of the same person) rolls the new account back.
  link(userId: string, identity: SocialIdentity, trx: Knex = db) {
    return trx(this.tableName).insert({
      userId,
      provider: identity.provider,
      providerUserId: identity.providerUserId,
      email: identity.email,
    });
  }

  // An existing account: a clash means a concurrent sign-in already linked it, or the account already has a
  // different account with this provider linked — either way there's nothing to add.
  async linkIfMissing(userId: string, identity: SocialIdentity) {
    await this.link(userId, identity).onConflict().ignore();
  }

  async removeAllForUser(userId: string, trx: Knex = db) {
    await trx(this.tableName).where({ userId }).del();
  }
}

export const socialAccountModel = new SocialAccountModel();
