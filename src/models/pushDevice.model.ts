import type { Knex } from "knex";
import db from "../database/knex.js";
import { MAX_DEVICES_PER_USER } from "../config/notificationTypes.js";
import { BaseModel } from "./BaseModel.js";

export type PushPlatform = "ios" | "android" | "web";

export interface WebPushKeys {
  p256dh: string;
  auth: string;
}

export interface PushDevice {
  id: string;
  userId: string;
  platform: PushPlatform;
  // Expo push token, or the browser's web-push endpoint URL. A secret: never in a response, a log or an audit entry.
  token: string;
  webKeys: WebPushKeys | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RegisterDeviceInput {
  platform: PushPlatform;
  token: string;
  webKeys?: WebPushKeys;
}

// BaseModel reads (the API's view) never return the token or keys; the methods the senders use return full rows.
class PushDeviceModel extends BaseModel<PushDevice> {
  protected readonly tableName = "pushDevices";
  protected readonly excludedColumns = ["token", "webKeys"];

  // Upserts on the token, so a phone that signs in as someone else is reassigned, and caps a user at
  // MAX_DEVICES_PER_USER by dropping the ones seen longest ago. isNew is true for a new row or a new owner, so
  // the apps re-registering on every launch don't each leave an audit entry. The user row is locked first, so two
  // registrations for one user queue up and the cap can't be overshot.
  async register(
    userId: string,
    { platform, token, webKeys }: RegisterDeviceInput,
  ): Promise<{ device: PushDevice; isNew: boolean }> {
    return db.transaction(async (trx) => {
      await trx("users").where({ id: userId }).forNoKeyUpdate().first("id");
      const existing: Pick<PushDevice, "userId"> | undefined = await trx(this.tableName)
        .where({ token })
        .forUpdate()
        .first("userId");

      const keys = webKeys ? JSON.stringify(webKeys) : null;
      const [row] = await trx(this.tableName)
        .insert({
          userId,
          platform,
          token,
          webKeys: keys,
          createdAt: trx.fn.now(),
          updatedAt: trx.fn.now(),
        })
        .onConflict("token")
        .merge({ userId, platform, webKeys: keys, updatedAt: trx.fn.now() })
        .returning("*");

      // Keep the newest MAX-1 others plus the row just written, which can never be the one trimmed.
      const keep = trx(this.tableName)
        .where({ userId })
        .whereNot("id", row.id)
        .orderBy([
          { column: "updatedAt", order: "desc" },
          { column: "id", order: "desc" },
        ])
        .limit(MAX_DEVICES_PER_USER - 1)
        .select("id");
      await trx(this.tableName)
        .where({ userId })
        .whereNot("id", row.id)
        .whereNotIn("id", keep)
        .del();

      return { device: this.sanitize(row as PushDevice), isNew: existing?.userId !== userId };
    });
  }

  // The devices to push to, full rows. A device not seen for staleDays belongs to a session that is long dead, so
  // it is deleted here, since nothing else would ever clean it up. The delete re-checks the age, so a device that
  // re-registered a moment ago is never removed.
  async listTargetsForUsers(userIds: string[], staleDays: number): Promise<PushDevice[]> {
    if (userIds.length === 0) return [];

    const stale = () =>
      this.table
        .whereIn("userId", userIds)
        .whereRaw(`"updatedAt" < now() - (? * interval '1 day')`, [staleDays]);
    await stale().del();

    return this.table.whereIn("userId", userIds).orderBy("createdAt");
  }

  listTargetsForUser(userId: string, staleDays: number) {
    return this.listTargetsForUsers([userId], staleDays);
  }

  // Only the caller's own row, so a token someone else holds can't be removed by guessing it.
  async removeByToken(token: string, userId: string): Promise<boolean> {
    return (await this.table.where({ token, userId }).del()) > 0;
  }

  removeByTokens(tokens: string[]): Promise<number> {
    if (tokens.length === 0) return Promise.resolve(0);
    return this.table.whereIn("token", tokens).del();
  }

  // Returns what it removed (full rows), so a notice can still reach those devices once they are signed out.
  async removeAllForUser(userId: string, trx: Knex = db): Promise<PushDevice[]> {
    return trx(this.tableName).where({ userId }).del().returning("*");
  }
}

export const pushDeviceModel = new PushDeviceModel();
