import type { Knex } from "knex";
import db from "../database/knex.js";
import { BaseModel } from "./BaseModel.js";
import type { NotificationType } from "../config/notificationTypes.js";

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  // Ids only (see PUSH_DATA_KEYS).
  data: Record<string, string>;
  readAt: Date | null;
  createdAt: Date;
}

export interface NewNotification {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface ListNotificationsQuery {
  page: number;
  limit: number;
  unread?: boolean;
  type?: string;
}

class NotificationModel extends BaseModel<Notification> {
  protected readonly tableName = "notifications";

  async create({ data = {}, ...input }: NewNotification, trx: Knex = db): Promise<Notification> {
    const [row] = await trx(this.tableName)
      .insert({ ...input, data: JSON.stringify(data) })
      .returning("*");
    return row;
  }

  async listForUser(
    userId: string,
    { page, limit, unread, type }: ListNotificationsQuery,
  ): Promise<{ totalItems: number; items: Notification[] }> {
    const matching = () =>
      this.table.where({ userId }).modify((query) => {
        if (unread === true) query.whereNull("readAt");
        if (unread === false) query.whereNotNull("readAt");
        if (type) query.where({ type });
      });

    const [counted, items] = await Promise.all([
      matching().first(db.raw("count(*)::int as total")) as Promise<{ total: number }>,
      matching()
        .orderBy([
          { column: "createdAt", order: "desc" },
          { column: "id", order: "desc" },
        ])
        .limit(limit)
        .offset((page - 1) * limit),
    ]);

    return { totalItems: counted.total, items };
  }

  async unreadCount(userId: string, trx: Knex = db): Promise<number> {
    const row = await trx(this.tableName)
      .where({ userId })
      .whereNull("readAt")
      .first(db.raw("count(*)::int as total"));
    return row.total;
  }

  // One UPDATE: the first read time is kept, and another user's row matches nothing (undefined).
  async markRead(id: string, userId: string): Promise<Notification | undefined> {
    const [row] = await this.table
      .where({ id, userId })
      .update({ readAt: db.raw('coalesce("readAt", now())') })
      .returning("*");
    return row;
  }

  markAllRead(userId: string): Promise<number> {
    return this.table.where({ userId }).whereNull("readAt").update({ readAt: db.fn.now() });
  }

  async remove(id: string, userId: string): Promise<boolean> {
    return (await this.table.where({ id, userId }).del()) > 0;
  }

  // One indexed DELETE (notifications_user_created); days may be fractional.
  pruneOlderThan(userId: string, days: number, trx: Knex = db): Promise<number> {
    return trx(this.tableName)
      .where({ userId })
      .whereRaw(`"createdAt" < now() - (? * interval '1 day')`, [days])
      .del();
  }

  removeAllForUser(userId: string, trx: Knex = db): Promise<number> {
    return trx(this.tableName).where({ userId }).del();
  }
}

export const notificationModel = new NotificationModel();
