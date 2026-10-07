import type { Request, Response } from "express";
import {
  EDITABLE_STATUSES,
  broadcastModel,
  smsTextOf,
  type Broadcast,
  type BroadcastDetail,
} from "../models/broadcast.model.js";
import { settingModel } from "../models/setting.model.js";
import { logActivity } from "../services/activityLog.service.js";
import { getSmsBalance } from "../services/sms.service.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import { SMS_MAX_SEGMENTS, smsSegments } from "../utils/sms.js";
import type {
  AudiencePreviewQuery,
  BroadcastParams,
  CreateBroadcastInput,
  ListBroadcastsQuery,
  ScheduleBroadcastInput,
  UpdateBroadcastInput,
} from "../schemas/broadcast.schema.js";

const BROADCAST_ACTIVITY = { module: "broadcasts", targetType: "broadcast" } as const;
const MIN_SCHEDULE_LEAD_MS = 60 * 1000;
const MAX_SCHEDULE_DAYS = 90;

function staffId(req: Request) {
  if (!req.auth) {
    throw AppError.unauthorized();
  }
  return req.auth.id;
}

function staff(id: string | null, fullName: string | null) {
  return id ? { id, fullName } : null;
}

function view(broadcast: BroadcastDetail) {
  return {
    id: broadcast.id,
    title: broadcast.title,
    body: broadcast.body,
    smsText: broadcast.smsText,
    audience: broadcast.audience,
    channels: broadcast.channels,
    smsSegments: smsSegments(smsTextOf(broadcast)),
    status: broadcast.status,
    scheduledFor: broadcast.scheduledFor,
    startedAt: broadcast.startedAt,
    sentAt: broadcast.sentAt,
    cancelledAt: broadcast.cancelledAt,
    createdBy: staff(broadcast.createdBy, broadcast.createdByName),
    updatedBy: staff(broadcast.updatedBy, broadcast.updatedByName),
    cancelledBy: staff(broadcast.cancelledBy, broadcast.cancelledByName),
    createdAt: broadcast.createdAt,
    updatedAt: broadcast.updatedAt,
  };
}

async function loadBroadcast(id: string) {
  const broadcast = await broadcastModel.findDetail(id);
  if (!broadcast) {
    throw AppError.notFound(`Broadcast not found: ${id}`);
  }
  return broadcast;
}

// A change refused because the broadcast has moved on, read again so the message names where it is now.
async function notEditable(id: string, doing: string) {
  const { status } = await loadBroadcast(id);
  return AppError.conflict(`The broadcast is ${status}, so it can't be ${doing}`);
}

// Checked whenever SMS is (or stays) a channel: every recipient's text costs this many messages.
function assertSmsFits(broadcast: Pick<Broadcast, "title" | "body" | "smsText" | "channels">) {
  if (!broadcast.channels.includes("sms")) return;
  const segments = smsSegments(smsTextOf(broadcast));
  if (segments > SMS_MAX_SEGMENTS) {
    throw AppError.badRequest(
      `The SMS would be ${segments} messages long; keep it to ${SMS_MAX_SEGMENTS} or set a shorter smsText`,
    );
  }
}

export async function listBroadcasts(req: Request, res: Response) {
  const query = req.validated.query as ListBroadcastsQuery;
  const { items, totalItems } = await broadcastModel.list(query);

  sendSuccess(res, "Broadcasts retrieved successfully", {
    items: items.map(view),
    pagination: {
      page: query.page,
      limit: query.limit,
      totalItems,
      totalPages: Math.ceil(totalItems / query.limit),
    },
  });
}

export async function getBroadcast(req: Request, res: Response) {
  const { id } = req.validated.params as BroadcastParams;
  sendSuccess(res, "Broadcast retrieved successfully", view(await loadBroadcast(id)));
}

export async function previewAudience(req: Request, res: Response) {
  const { audience } = req.validated.query as AudiencePreviewQuery;
  const staleDays = await settingModel.getValue("push.deviceStaleDays");
  sendSuccess(
    res,
    "Audience counted successfully",
    await broadcastModel.audienceReach(audience, staleDays),
  );
}

export async function smsBalance(_req: Request, res: Response) {
  sendSuccess(res, "SMS balance retrieved successfully", await getSmsBalance());
}

export async function createBroadcast(req: Request, res: Response) {
  const input = req.validated.body as CreateBroadcastInput;
  const by = staffId(req);
  const fields = { ...input, smsText: input.smsText ?? null };
  assertSmsFits(fields);

  const { id } = await broadcastModel.create({ ...fields, createdBy: by, updatedBy: by });
  const created = view(await loadBroadcast(id));

  sendCreated(res, "Broadcast created successfully", created);
  logActivity(req, {
    ...BROADCAST_ACTIVITY,
    action: "broadcast.create",
    description: `Drafted the broadcast "${created.title}" to ${created.audience}`,
    targetId: id,
    after: created,
  });
}

export async function updateBroadcast(req: Request, res: Response) {
  const { id } = req.validated.params as BroadcastParams;
  const input = req.validated.body as UpdateBroadcastInput;
  const existing = await loadBroadcast(id);
  if (!EDITABLE_STATUSES.includes(existing.status)) {
    throw await notEditable(id, "edited");
  }

  const changes = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<Broadcast>;
  assertSmsFits({ ...existing, ...changes });

  const updated = await broadcastModel.updateWhile(id, EDITABLE_STATUSES, {
    ...changes,
    updatedBy: staffId(req),
  });
  if (!updated) {
    throw await notEditable(id, "edited");
  }
  const after = view(await loadBroadcast(id));

  sendSuccess(res, "Broadcast updated successfully", after);
  logActivity(req, {
    ...BROADCAST_ACTIVITY,
    action: "broadcast.update",
    description: `Edited the broadcast "${after.title}"`,
    targetId: id,
    before: view(existing),
    after,
  });
}

export async function scheduleBroadcast(req: Request, res: Response) {
  const { id } = req.validated.params as BroadcastParams;
  const { scheduledFor } = req.validated.body as ScheduleBroadcastInput;
  const when = new Date(scheduledFor);
  if (when.getTime() < Date.now() + MIN_SCHEDULE_LEAD_MS) {
    throw AppError.badRequest("scheduledFor must be at least a minute from now");
  }
  if (when.getTime() > Date.now() + MAX_SCHEDULE_DAYS * 86_400_000) {
    throw AppError.badRequest(`scheduledFor can be at most ${MAX_SCHEDULE_DAYS} days ahead`);
  }

  const existing = await loadBroadcast(id);
  const updated = await broadcastModel.updateWhile(id, EDITABLE_STATUSES, {
    status: "scheduled",
    scheduledFor: when,
    updatedBy: staffId(req),
  });
  if (!updated) {
    throw await notEditable(id, "scheduled");
  }
  const after = view(await loadBroadcast(id));

  sendSuccess(res, "Broadcast scheduled successfully", after);
  logActivity(req, {
    ...BROADCAST_ACTIVITY,
    action: "broadcast.schedule",
    description: `${existing.status === "scheduled" ? "Rescheduled" : "Scheduled"} the broadcast "${after.title}" for ${when.toISOString()}`,
    targetId: id,
    before: view(existing),
    after,
  });
}

export async function cancelBroadcast(req: Request, res: Response) {
  const { id } = req.validated.params as BroadcastParams;
  const existing = await loadBroadcast(id);
  if (existing.status === "draft") {
    throw AppError.conflict("Only a scheduled broadcast can be cancelled; delete a draft instead");
  }

  const by = staffId(req);
  const updated = await broadcastModel.updateWhile(id, ["scheduled"], {
    status: "cancelled",
    cancelledAt: new Date(),
    cancelledBy: by,
    updatedBy: by,
  });
  if (!updated) {
    throw await notEditable(id, "cancelled");
  }
  const after = view(await loadBroadcast(id));

  sendSuccess(res, "Broadcast cancelled successfully", after);
  logActivity(req, {
    ...BROADCAST_ACTIVITY,
    action: "broadcast.cancel",
    description: `Cancelled the broadcast "${after.title}"`,
    targetId: id,
    before: view(existing),
    after,
  });
}

export async function deleteBroadcast(req: Request, res: Response) {
  const { id } = req.validated.params as BroadcastParams;
  const existing = await loadBroadcast(id);
  if (!(await broadcastModel.deleteDraft(id))) {
    throw AppError.conflict(
      `The broadcast is ${(await loadBroadcast(id)).status}, so it can't be deleted; only drafts can`,
    );
  }

  sendSuccess(res, "Broadcast deleted successfully");
  logActivity(req, {
    ...BROADCAST_ACTIVITY,
    action: "broadcast.delete",
    description: `Deleted the draft broadcast "${existing.title}"`,
    targetId: id,
    before: view(existing),
  });
}
