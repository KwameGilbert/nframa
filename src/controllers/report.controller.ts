import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import {
  reportModel,
  type ReportEvidence,
  type TripReport,
  type TripReportListItem,
} from "../models/report.model.js";
import { settingModel } from "../models/setting.model.js";
import { tripModel, type Trip } from "../models/trip.model.js";
import { logActivity } from "../services/activityLog.service.js";
import { sendReportEmail } from "../services/email.service.js";
import { emitToReportsDesk, emitToUser } from "../services/socket.service.js";
import {
  notifyReportCreated,
  notifyReport,
  notifyReportsDesk,
} from "../services/notificationEvents.service.js";
import { deleteFile, uploadFile } from "../services/storage.service.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import {
  URGENT_REPORT_CATEGORIES,
  type AdminListReportsQuery,
  type CreateReportInput,
  type ListMyReportsQuery,
  type UpdateReportStatusInput,
} from "../schemas/report.schema.js";

const REPORT_ACTIVITY = { module: "reports", targetType: "report" } as const;

function callerId(req: Request) {
  if (!req.auth) {
    throw AppError.unauthorized();
  }

  return req.auth.id;
}

const notFound = (id: string) => AppError.notFound(`Report not found: ${id}`);

// Why a guarded update changed nothing: the report moved on (or was withdrawn) between our read and the update.
async function refusal(id: string, message: (current: TripReport) => string) {
  const current = await reportModel.findById(id);
  return current ? AppError.conflict(message(current)) : notFound(id);
}

const evidenceUrls = (evidence: ReportEvidence[]) => evidence.map(({ fileUrl }) => ({ fileUrl }));

// What the person who filed it sees: never staff's notes, which admin handled it, or the storage keys.
function reporterView(report: TripReport) {
  return {
    id: report.id,
    tripId: report.tripId,
    reporterRole: report.reporterRole,
    category: report.category,
    severity: report.severity,
    description: report.description,
    tripStatus: report.tripStatus,
    evidence: evidenceUrls(report.evidence),
    status: report.status,
    outcomeMessage: report.outcomeMessage,
    resolvedAt: report.resolvedAt,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
  };
}

function adminView(report: TripReport) {
  return {
    ...reporterView(report),
    reporterUserId: report.reporterUserId,
    reportedUserId: report.reportedUserId,
    internalNotes: report.internalNotes,
    handledByAdminId: report.handledByAdminId,
  };
}

// The audit trail records that a report existed and what happened to it, not what was said.
function auditView(report: TripReport) {
  return {
    id: report.id,
    tripId: report.tripId,
    category: report.category,
    severity: report.severity,
    status: report.status,
    evidenceCount: report.evidence.length,
  };
}

const statusChange = (report: TripReport) => ({
  reportId: report.id,
  status: report.status,
  updatedAt: report.updatedAt,
});

// A trip can be reported once it was accepted: while the rider waits, on the ride, and for a while after it ends
// (completed, cancelled after being accepted, or a no-show). Never a request nobody accepted.
async function assertReportable(trip: Trip) {
  if (trip.status === "accepted" || trip.status === "boarded") return;

  const ended =
    trip.status === "completed" || trip.status === "no_show" || trip.status === "cancelled";
  if (!ended || !trip.acceptedAt) {
    throw AppError.conflict(
      ended
        ? "Can't report a trip that was cancelled before it was accepted"
        : `Can't report a trip that is ${trip.status}`,
    );
  }

  const hours = await settingModel.getValue("reports.filingWindowHours");
  const endedAt = trip.completedAt ?? trip.cancelledAt;
  if (!endedAt || Date.now() > endedAt.getTime() + hours * 3_600_000) {
    throw AppError.conflict(`Reports can be filed up to ${hours} hours after a trip ends`);
  }
}

export async function createReport(req: Request, res: Response) {
  const reporterUserId = callerId(req);
  const { tripId } = req.validated.params as { tripId: string };
  const input = req.validated.body as CreateReportInput;

  await tripModel.settleStale({ id: tripId });
  const trip = await tripModel.findById(tripId);
  if (!trip) {
    throw AppError.notFound(`Trip not found: ${tripId}`);
  }
  const isRider = trip.riderUserId === reporterUserId;
  if (!isRider && trip.driverUserId !== reporterUserId) {
    throw AppError.forbidden("Only the trip's rider or driver can report it");
  }
  await assertReportable(trip);

  // The images go up before the row is written; if anything fails they are taken down again.
  const id = randomUUID();
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const evidence: ReportEvidence[] = [];
  let report: TripReport;
  try {
    for (const file of files) {
      evidence.push(await uploadFile(file.buffer, `reports/${id}`, file.originalname));
    }
    report = await reportModel.createReport({
      id,
      tripId,
      reporterUserId,
      reportedUserId: isRider ? trip.driverUserId : trip.riderUserId,
      reporterRole: isRider ? "rider" : "driver",
      category: input.category,
      severity: URGENT_REPORT_CATEGORIES.includes(input.category) ? "urgent" : "normal",
      description: input.description,
      tripStatus: trip.status,
      evidence,
    });
  } catch (err) {
    await Promise.allSettled(evidence.map(({ storageKey }) => deleteFile(storageKey)));
    throw err;
  }

  sendCreated(res, "Report filed successfully", reporterView(report));

  emitToReportsDesk("report:created", {
    reportId: report.id,
    tripId: report.tripId,
    category: report.category,
    severity: report.severity,
    reporterRole: report.reporterRole,
    createdAt: report.createdAt,
  });
  void notifyReportCreated(reporterUserId, { id: report.id, severity: report.severity });
  void notifyReportsDesk({ id: report.id, severity: report.severity });
  void sendReportEmail(reporterUserId, "received", { urgent: report.severity === "urgent" });

  logActivity(req, {
    ...REPORT_ACTIVITY,
    action: "report.create",
    description: `Reported the ${isRider ? "driver" : "rider"} on a trip (${report.category})`,
    targetId: report.id,
    after: auditView(report),
    redact: ["description"],
  });
}

export async function listMyReports(req: Request, res: Response) {
  const query = req.validated.query as ListMyReportsQuery;
  const { items, totalItems } = await reportModel.listForReporter(callerId(req), query);

  sendSuccess(res, "Reports retrieved successfully", {
    items: items.map(reporterView),
    pagination: {
      page: query.page,
      limit: query.limit,
      totalItems,
      totalPages: Math.ceil(totalItems / query.limit),
    },
  });
}

export async function getMyReport(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const report = await reportModel.findOwned(id, callerId(req));
  if (!report) {
    throw notFound(id);
  }

  sendSuccess(res, "Report retrieved successfully", reporterView(report));
}

export async function withdrawReport(req: Request, res: Response) {
  const reporterUserId = callerId(req);
  const { id } = req.validated.params as { id: string };

  const existing = await reportModel.findOwned(id, reporterUserId);
  if (!existing) {
    throw notFound(id);
  }

  const report = await reportModel.withdraw(id, reporterUserId);
  if (!report) {
    throw await refusal(id, (current) => `Can't withdraw a report that is ${current.status}`);
  }

  sendSuccess(res, "Report withdrawn successfully", reporterView(report));

  emitToReportsDesk("report:statusChanged", statusChange(report));

  logActivity(req, {
    ...REPORT_ACTIVITY,
    action: "report.withdraw",
    description: "Withdrew a report",
    targetId: id,
    before: auditView(existing),
    after: auditView(report),
  });
}

export async function adminListReports(req: Request, res: Response) {
  const query = req.validated.query as AdminListReportsQuery;
  const { items, totalItems } = await reportModel.adminList(query);

  sendSuccess(res, "Reports retrieved successfully", {
    items: items.map((item: TripReportListItem) => ({
      ...adminView(item),
      reporterName: item.reporterName,
      reportedName: item.reportedName,
    })),
    pagination: {
      page: query.page,
      limit: query.limit,
      totalItems,
      totalPages: Math.ceil(totalItems / query.limit),
    },
  });

  logActivity(req, {
    ...REPORT_ACTIVITY,
    action: "report.list",
    description: `Viewed ${items.length} report${items.length === 1 ? "" : "s"} (page ${query.page})`,
  });
}

export async function adminGetReport(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const detail = await reportModel.adminDetail(id);
  if (!detail) {
    throw notFound(id);
  }

  sendSuccess(res, "Report retrieved successfully", {
    ...adminView(detail.report),
    reporter: detail.reporter,
    reported: detail.reported,
    trip: detail.trip,
    history: detail.history,
  });

  // The report holds one person's account of another and their phone numbers: looking is recorded.
  logActivity(req, {
    ...REPORT_ACTIVITY,
    action: "report.view",
    description: "Viewed a report",
    targetId: id,
  });
}

export async function adminUpdateReportStatus(req: Request, res: Response) {
  const adminId = callerId(req);
  const { id } = req.validated.params as { id: string };
  const input = req.validated.body as UpdateReportStatusInput;

  const existing = await reportModel.findById(id);
  if (!existing) {
    throw notFound(id);
  }

  const report = await reportModel.moveStatusByAdmin(id, adminId, input);
  if (!report) {
    throw await refusal(
      id,
      (current) => `Can't move a report from ${current.status} to ${input.status}`,
    );
  }

  sendSuccess(res, "Report updated successfully", adminView(report));

  // The reporter follows along live and by email; the rest of the desk sees who moved it. The person reported is
  // never told.
  emitToUser(report.reporterUserId, "report:statusChanged", statusChange(report));
  emitToReportsDesk("report:statusChanged", statusChange(report));
  void notifyReport(report.reporterUserId, { id: report.id, status: report.status });
  void notifyReportsDesk({ id: report.id, severity: report.severity });
  void sendReportEmail(report.reporterUserId, input.status, {
    outcomeMessage: report.outcomeMessage,
  });

  logActivity(req, {
    ...REPORT_ACTIVITY,
    action: "report.updateStatus",
    description: `Moved a report to ${input.status}`,
    targetId: id,
    before: auditView(existing),
    after: auditView(report),
    redact: ["internalNotes", "outcomeMessage"],
  });
}
