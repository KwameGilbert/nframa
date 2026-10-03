import db from "../database/knex.js";
import { BaseModel } from "./BaseModel.js";
import type {
  ListSosIncidentsQuery,
  SosIncidentStatus,
  TriggerSosInput,
  UpdateSosStatusInput,
} from "../schemas/sosIncident.schema.js";

export interface SosIncident {
  id: string;
  userId: string;
  tripId: string | null;
  role: "rider" | "driver";
  status: SosIncidentStatus;
  latitude: number;
  longitude: number;
  address: string | null;
  reason: string | null;
  emergencyContactsSnapshot: Record<string, unknown>[] | null;
  resolvedByAdminId: string | null;
  resolutionNotes: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SosIncidentWithUser extends SosIncident {
  userFullName: string | null;
  userPhone: string | null;
}

// In play: the person is still waiting for help. Only one of these per person (sosIncidents_one_active_per_user).
const ACTIVE_STATUSES: SosIncidentStatus[] = ["triggered", "underReview", "servicesContacted"];
// The person can still call it off. Once emergency services have been contacted only operations can close it.
const USER_CANCELLABLE_STATUSES: SosIncidentStatus[] = ["triggered", "underReview"];
// Operations moves an alert forward, never back: a status can be set from itself or any earlier one.
const STATUS_ORDER: SosIncidentStatus[] = [
  "triggered",
  "underReview",
  "servicesContacted",
  "resolved",
];

const WITH_USER = [
  "sosIncidents.*",
  "users.fullName as userFullName",
  "users.phoneCountryCode as userPhoneCountryCode",
  "users.phoneNumber as userPhoneNumber",
];

type JoinedRow = SosIncident & {
  userFullName: string | null;
  userPhoneCountryCode: string | null;
  userPhoneNumber: string | null;
};

class SosIncidentModel extends BaseModel<SosIncident> {
  protected readonly tableName = "sosIncidents";

  // pg returns numeric columns as strings; clients get numbers. Every read goes through this, so a "before"
  // loaded with findById has the same shape as the "after" an update returns.
  protected sanitize(row: SosIncident): SosIncident {
    return { ...row, latitude: Number(row.latitude), longitude: Number(row.longitude) };
  }

  private withUser({
    userFullName,
    userPhoneCountryCode,
    userPhoneNumber,
    ...row
  }: JoinedRow): SosIncidentWithUser {
    return {
      ...this.sanitize(row),
      userFullName,
      userPhone: userPhoneNumber ? `${userPhoneCountryCode ?? ""}${userPhoneNumber}` : null,
    };
  }

  async findActiveByUser(userId: string): Promise<SosIncident | undefined> {
    const row = await this.table
      .where({ userId })
      .whereIn("status", ACTIVE_STATUSES)
      .orderBy("createdAt", "desc")
      .first();

    return row && this.sanitize(row);
  }

  // One alert in play per person: a second press (or a second phone) gets the alert already raised back, with
  // created: false so nobody is alerted twice. The unique index decides, so simultaneous presses can't both win.
  async triggerIncident(
    input: TriggerSosInput,
    userId: string,
    role: SosIncident["role"],
    emergencyContactsSnapshot: unknown[],
  ): Promise<{ incident: SosIncident; created: boolean }> {
    try {
      const [row] = await this.table
        .insert({
          userId,
          tripId: input.tripId ?? null,
          role,
          status: "triggered",
          latitude: input.latitude,
          longitude: input.longitude,
          address: input.address ?? null,
          reason: input.reason ?? null,
          emergencyContactsSnapshot: JSON.stringify(emergencyContactsSnapshot),
        })
        .returning("*");
      return { incident: this.sanitize(row), created: true };
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        const existing = await this.findActiveByUser(userId);
        if (existing) return { incident: existing, created: false };
      }
      this.handleDbError(err);
    }
  }

  // Only while the person can still call it off: the status check is part of the UPDATE, so a dispatcher marking
  // services contacted at the same moment can't be overwritten. Undefined when it was no longer cancellable.
  async cancelByUser(id: string, cancellationReason?: string): Promise<SosIncident | undefined> {
    const now = new Date();
    const [row] = await this.table
      .where({ id })
      .whereIn("status", USER_CANCELLABLE_STATUSES)
      .update({
        status: "cancelledByUser",
        // Keep what operations has already written unless the person gave a reason.
        resolutionNotes: db.raw(`coalesce(?::text, "resolutionNotes", ?::text)`, [
          cancellationReason ?? null,
          "Cancelled by user (false alarm)",
        ]),
        resolvedAt: now,
        updatedAt: now,
      })
      .returning("*");

    return row && this.sanitize(row);
  }

  // Forward only, and only while the alert is in play (guarded in the UPDATE, like cancelByUser). resolvedAt and
  // resolvedByAdminId are set when it is resolved, so they always mean "who closed it". Undefined when the move
  // wasn't allowed from the incident's current status.
  async updateStatusByAdmin(
    id: string,
    adminId: string,
    input: UpdateSosStatusInput,
  ): Promise<SosIncident | undefined> {
    const now = new Date();
    const allowedFrom = ACTIVE_STATUSES.filter(
      (status) => STATUS_ORDER.indexOf(status) <= STATUS_ORDER.indexOf(input.status),
    );
    const changes: Record<string, unknown> = { status: input.status, updatedAt: now };

    if (input.resolutionNotes !== undefined) {
      changes.resolutionNotes = input.resolutionNotes;
    }
    if (input.status === "resolved") {
      changes.resolvedAt = now;
      changes.resolvedByAdminId = adminId;
    }

    const [row] = await this.table
      .where({ id })
      .whereIn("status", allowedFrom)
      .update(changes)
      .returning("*");

    return row && this.sanitize(row);
  }

  async findIncidentWithUser(id: string): Promise<SosIncidentWithUser | undefined> {
    const row: JoinedRow | undefined = await this.table
      .leftJoin("users", "sosIncidents.userId", "users.id")
      .where("sosIncidents.id", id)
      .first(WITH_USER);

    return row && this.withUser(row);
  }

  async listIncidents({ status, userId, page, limit }: ListSosIncidentsQuery) {
    const matching = () =>
      this.table.leftJoin("users", "sosIncidents.userId", "users.id").modify((query) => {
        if (status) query.where("sosIncidents.status", status);
        if (userId) query.where("sosIncidents.userId", userId);
      });

    const [counted, rows] = await Promise.all([
      matching().first(db.raw("count(*)::int as total")) as Promise<{ total: number }>,
      matching()
        .select(WITH_USER)
        .orderBy([
          { column: "sosIncidents.createdAt", order: "desc" },
          { column: "sosIncidents.id", order: "desc" },
        ])
        .limit(limit)
        .offset((page - 1) * limit) as Promise<JoinedRow[]>,
    ]);

    return { totalItems: counted.total, items: rows.map((row) => this.withUser(row)) };
  }
}

export const sosIncidentModel = new SosIncidentModel();
