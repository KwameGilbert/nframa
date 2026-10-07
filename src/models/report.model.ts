import db from "../database/knex.js";
import { AppError } from "../utils/AppError.js";
import { BaseModel } from "./BaseModel.js";
import type {
  AdminListReportsQuery,
  ListMyReportsQuery,
  ReportCategory,
  ReportSeverity,
  ReportStatus,
  UpdateReportStatusInput,
} from "../schemas/report.schema.js";

export interface ReportEvidence {
  fileUrl: string;
  // Internal: the storage provider's id, kept so the file can be deleted. Never returned to a client.
  storageKey: string;
}

export interface TripReport {
  id: string;
  tripId: string;
  reporterUserId: string;
  reportedUserId: string;
  reporterRole: "rider" | "driver";
  category: ReportCategory;
  severity: ReportSeverity;
  description: string;
  tripStatus: string;
  evidence: ReportEvidence[];
  status: ReportStatus;
  handledByAdminId: string | null;
  internalNotes: string | null;
  outcomeMessage: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type NewReport = Pick<
  TripReport,
  | "id"
  | "tripId"
  | "reporterUserId"
  | "reportedUserId"
  | "reporterRole"
  | "category"
  | "severity"
  | "description"
  | "tripStatus"
  | "evidence"
>;

export type TripReportListItem = TripReport & {
  reporterName: string | null;
  reportedName: string | null;
};

interface Person {
  id: string;
  fullName: string | null;
  phone: string | null;
  role: "rider" | "driver" | "admin";
}

export interface TripReportDetail {
  report: TripReport;
  reporter: Person;
  reported: Person;
  trip: Record<string, unknown>;
  history: { reporterFiled: number; reportedAgainst: number; reportedUnresolved: number };
}

// Still waiting on staff or being handled: the person can take it back and staff can still move it.
export const LIVE_REPORT_STATUSES: ReportStatus[] = ["open", "underReview"];

const WITH_PEOPLE = [
  "tripReports.*",
  "reporter.fullName as reporterName",
  "reported.fullName as reportedName",
];

class ReportModel extends BaseModel<TripReport> {
  protected readonly tableName = "tripReports";

  // The unique index decides when two filings of the same live report race: one wins, the other gets the 409.
  async createReport(input: NewReport): Promise<TripReport> {
    try {
      const [row] = await this.table
        .insert({ ...input, evidence: JSON.stringify(input.evidence) })
        .returning("*");
      return this.sanitize(row);
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw AppError.conflict("You already have an open report about this trip in that category");
      }
      this.handleDbError(err);
    }
  }

  async findOwned(id: string, reporterUserId: string): Promise<TripReport | undefined> {
    const row = await this.table.where({ id, reporterUserId }).first();
    return row && this.sanitize(row);
  }

  async listForReporter(
    reporterUserId: string,
    { status, tripId, page, limit }: ListMyReportsQuery,
  ) {
    const matching = () =>
      this.table.where({ reporterUserId }).modify((query) => {
        if (status) query.where({ status });
        if (tripId) query.where({ tripId });
      });

    const [counted, rows] = await Promise.all([
      matching().first(db.raw("count(*)::int as total")) as Promise<{ total: number }>,
      matching()
        .orderBy([
          { column: "createdAt", order: "desc" },
          { column: "id", order: "desc" },
        ])
        .limit(limit)
        .offset((page - 1) * limit) as Promise<TripReport[]>,
    ]);

    return { totalItems: counted.total, items: rows.map((row) => this.sanitize(row)) };
  }

  // The staff queue: what still needs a person first, urgent before the rest, newest first within each.
  async adminList(query: AdminListReportsQuery) {
    const {
      status,
      severity,
      category,
      reporterUserId,
      reportedUserId,
      tripId,
      from,
      to,
      page,
      limit,
    } = query;
    const matching = () =>
      this.table
        .leftJoin("users as reporter", "reporter.id", "tripReports.reporterUserId")
        .leftJoin("users as reported", "reported.id", "tripReports.reportedUserId")
        .modify((q) => {
          if (status) q.where("tripReports.status", status);
          if (severity) q.where("tripReports.severity", severity);
          if (category) q.where("tripReports.category", category);
          if (reporterUserId) q.where("tripReports.reporterUserId", reporterUserId);
          if (reportedUserId) q.where("tripReports.reportedUserId", reportedUserId);
          if (tripId) q.where("tripReports.tripId", tripId);
          if (from) q.where("tripReports.createdAt", ">=", new Date(`${from}T00:00:00Z`));
          if (to) {
            q.where(
              "tripReports.createdAt",
              "<",
              new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000),
            );
          }
        });

    const [counted, rows] = await Promise.all([
      matching().first(db.raw("count(*)::int as total")) as Promise<{ total: number }>,
      matching()
        .select(WITH_PEOPLE)
        .orderByRaw(
          `("tripReports"."status" IN ('open', 'underReview')) DESC, ("tripReports"."severity" = 'urgent') DESC, "tripReports"."createdAt" DESC, "tripReports"."id" DESC`,
        )
        .limit(limit)
        .offset((page - 1) * limit) as Promise<TripReportListItem[]>,
    ]);

    return { totalItems: counted.total, items: rows };
  }

  // The report with both people, the trip, and how each person shows up in other reports.
  async adminDetail(id: string): Promise<TripReportDetail | undefined> {
    const report = await this.findById(id);
    if (!report) return undefined;

    const [people, trip, reporterHistory, reportedHistory] = await Promise.all([
      db("users")
        .whereIn("id", [report.reporterUserId, report.reportedUserId])
        .select("id", "fullName", "phoneCountryCode", "phoneNumber", "role"),
      db("trips")
        .where({ id: report.tripId })
        .first(
          "id",
          "status",
          "tripDate",
          "pickupAddress",
          "dropoffAddress",
          "scheduledPickupAt",
          "boardedAt",
          "completedAt",
          "cancelledAt",
        ),
      db("tripReports")
        .where({ reporterUserId: report.reporterUserId })
        .first(db.raw("count(*)::int as total")),
      db("tripReports")
        .where({ reportedUserId: report.reportedUserId })
        .first(
          db.raw("count(*)::int as total"),
          db.raw(`count(*) filter (where "status" in ('open', 'underReview'))::int as unresolved`),
        ),
    ]);

    const person = (userId: string): Person => {
      const row = people.find((p: { id: string }) => p.id === userId);
      return {
        id: userId,
        fullName: row?.fullName ?? null,
        phone: row?.phoneNumber ? `${row.phoneCountryCode ?? ""}${row.phoneNumber}` : null,
        role: row?.role ?? "rider",
      };
    };

    return {
      report,
      reporter: person(report.reporterUserId),
      reported: person(report.reportedUserId),
      trip,
      history: {
        reporterFiled: reporterHistory.total,
        reportedAgainst: reportedHistory.total,
        reportedUnresolved: reportedHistory.unresolved,
      },
    };
  }

  // Staff move a report on while it is live. The status check is part of the UPDATE, so a reporter withdrawing at
  // the same moment can't be overwritten. Notes and the message to the reporter only change when given. Undefined
  // when the report was no longer live.
  async moveStatusByAdmin(
    id: string,
    adminId: string,
    { status, internalNotes, outcomeMessage }: UpdateReportStatusInput,
  ): Promise<TripReport | undefined> {
    const now = new Date();
    const [row] = await this.table
      .where({ id })
      .whereIn("status", LIVE_REPORT_STATUSES)
      .update({
        status,
        handledByAdminId: adminId,
        internalNotes: db.raw(`coalesce(?::text, "internalNotes")`, [internalNotes ?? null]),
        outcomeMessage: db.raw(`coalesce(?::text, "outcomeMessage")`, [outcomeMessage ?? null]),
        ...(status === "underReview" ? {} : { resolvedAt: now }),
        updatedAt: now,
      })
      .returning("*");

    return row && this.sanitize(row);
  }

  // The reporter taking their own report back, while staff haven't closed it. Undefined when it wasn't live.
  async withdraw(id: string, reporterUserId: string): Promise<TripReport | undefined> {
    const now = new Date();
    const [row] = await this.table
      .where({ id, reporterUserId })
      .whereIn("status", LIVE_REPORT_STATUSES)
      .update({ status: "withdrawn", updatedAt: now })
      .returning("*");

    return row && this.sanitize(row);
  }
}

export const reportModel = new ReportModel();
