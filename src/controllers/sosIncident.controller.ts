import type { Request, Response } from "express";
import { emergencyContactModel } from "../models/emergencyContact.model.js";
import { sosIncidentModel, type SosIncident } from "../models/sosIncident.model.js";
import { tripModel } from "../models/trip.model.js";
import { logActivity } from "../services/activityLog.service.js";
import { sendSosEmail } from "../services/email.service.js";
import { emitToSafetyDesk, emitToUser } from "../services/socket.service.js";
import { notifySafetyDesk, notifySos } from "../services/notificationEvents.service.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import type {
  AdminCancelSosInput,
  CancelSosInput,
  ListSosIncidentsQuery,
  TriggerSosInput,
  UpdateSosStatusInput,
} from "../schemas/sosIncident.schema.js";

const SOS_ACTIVITY = { module: "sos", targetType: "sosIncident" } as const;

function callerId(req: Request) {
  if (!req.auth) {
    throw AppError.unauthorized();
  }

  return req.auth.id;
}

// What the person who raised the alert sees: not operations' internal notes or which admin handled it.
function userView(incident: SosIncident) {
  const visible: Partial<SosIncident> = { ...incident };
  delete visible.resolvedByAdminId;
  delete visible.resolutionNotes;
  return visible;
}

// What the safety desk is alerted with: enough to open the incident (GET /admin/safety/incidents/:id has the rest,
// including the person's contacts and phone, which a socket event shouldn't carry).
const alertOf = (incident: SosIncident) => ({
  incidentId: incident.id,
  userId: incident.userId,
  role: incident.role,
  tripId: incident.tripId,
  status: incident.status,
  latitude: incident.latitude,
  longitude: incident.longitude,
  address: incident.address,
  reason: incident.reason,
  createdAt: incident.createdAt,
});

const statusChangeOf = (incident: SosIncident) => ({
  incidentId: incident.id,
  userId: incident.userId,
  status: incident.status,
  updatedAt: incident.updatedAt,
});

// Why a guarded update changed nothing: the incident moved on (or was cancelled) between our read and the update.
async function refusal(id: string, message: (current: SosIncident) => string) {
  const current = await sosIncidentModel.findById(id);
  if (!current) {
    return AppError.notFound(`SOS incident not found: ${id}`);
  }
  return AppError.conflict(message(current));
}

export async function triggerSos(req: Request, res: Response) {
  const userId = callerId(req);
  if (req.auth?.role !== "rider" && req.auth?.role !== "driver") {
    throw AppError.forbidden("Only riders and drivers can raise an SOS alert");
  }
  const role = req.auth.role;
  const input = req.validated.body as TriggerSosInput;

  if (input.tripId) {
    const trip = await tripModel.findById(input.tripId);
    if (!trip) {
      throw AppError.badRequest(`Trip not found: ${input.tripId}`);
    }
    if (trip.riderUserId !== userId && trip.driverUserId !== userId) {
      throw AppError.forbidden("You aren't on that trip");
    }
  }

  // The contacts as they are at the moment of panic, so a later edit can't change who was meant to be told.
  const contacts = await emergencyContactModel.listForUser(userId);
  const { incident, created } = await sosIncidentModel.triggerIncident(
    input,
    userId,
    role,
    contacts,
  );

  if (!created) {
    sendSuccess(res, "An SOS alert is already active", userView(incident));
    return;
  }

  sendCreated(res, "Emergency SOS alert triggered successfully", userView(incident));

  emitToSafetyDesk("sos:triggered", alertOf(incident));
  void notifySafetyDesk(incident.id);
  void sendSosEmail(userId, "triggered");

  logActivity(req, {
    ...SOS_ACTIVITY,
    action: "sos.trigger",
    description: "Triggered emergency SOS alert",
    targetId: incident.id,
    after: incident,
  });
}

export async function getActiveSos(req: Request, res: Response) {
  const active = await sosIncidentModel.findActiveByUser(callerId(req));

  sendSuccess(res, "Active SOS status retrieved successfully", active ? userView(active) : null);
}

// Only the person who raised the alert can call it off, and only until emergency services have been contacted:
// after that it's operations' to close. Admins have the status route.
export async function cancelSos(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };
  const { cancellationReason } = req.validated.body as CancelSosInput;

  const existing = await sosIncidentModel.findById(id);
  if (!existing) {
    throw AppError.notFound(`SOS incident not found: ${id}`);
  }
  if (existing.userId !== callerId(req)) {
    throw AppError.forbidden("Only the person who raised the alert can cancel it");
  }

  const incident = await sosIncidentModel.cancelByUser(id, cancellationReason);
  if (!incident) {
    throw await refusal(id, (current) =>
      current.status === "servicesContacted"
        ? "Emergency services have already been contacted, so only operations can close this alert"
        : `Can't cancel an SOS alert that is ${current.status}`,
    );
  }

  sendSuccess(res, "Emergency SOS alert cancelled successfully", userView(incident));

  emitToSafetyDesk("sos:cancelled", statusChangeOf(incident));

  logActivity(req, {
    ...SOS_ACTIVITY,
    action: "sos.cancel",
    description: "Cancelled emergency SOS alert",
    targetId: id,
    before: existing,
    after: incident,
  });
}

// Staff calling an alert off from any status that is still in play, e.g. a false alarm or a duplicate.
export async function adminCancelIncident(req: Request, res: Response) {
  const adminId = callerId(req);
  const { id } = req.validated.params as { id: string };
  const { resolutionNotes } = req.validated.body as AdminCancelSosInput;

  const existing = await sosIncidentModel.findById(id);
  if (!existing) {
    throw AppError.notFound(`SOS incident not found: ${id}`);
  }

  const incident = await sosIncidentModel.cancelByAdmin(id, adminId, resolutionNotes);
  if (!incident) {
    throw await refusal(id, (current) => `Can't cancel an SOS alert that is ${current.status}`);
  }

  sendSuccess(res, "SOS incident cancelled successfully", incident);

  // The person's status screen follows along live; the rest of the desk drops it from the queue.
  emitToUser(incident.userId, "sos:statusChanged", statusChangeOf(incident));
  emitToSafetyDesk("sos:cancelled", statusChangeOf(incident));
  void notifySos(incident.userId, { id: incident.id, status: incident.status });
  void sendSosEmail(incident.userId, incident.status);

  logActivity(req, {
    ...SOS_ACTIVITY,
    action: "sos.adminCancel",
    description: "Cancelled an SOS incident as an admin",
    targetId: id,
    before: existing,
    after: incident,
  });
}

export async function adminListIncidents(req: Request, res: Response) {
  const query = req.validated.query as ListSosIncidentsQuery;
  const { items, totalItems } = await sosIncidentModel.listIncidents(query);

  sendSuccess(res, "SOS incidents retrieved successfully", {
    items,
    pagination: {
      page: query.page,
      limit: query.limit,
      totalItems,
      totalPages: Math.ceil(totalItems / query.limit),
    },
  });

  logActivity(req, {
    ...SOS_ACTIVITY,
    action: "sos.list",
    description: `Viewed ${items.length} SOS incident${items.length === 1 ? "" : "s"} (page ${query.page})`,
  });
}

export async function adminGetIncident(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const incident = await sosIncidentModel.findIncidentWithUser(id);
  if (!incident) {
    throw AppError.notFound(`SOS incident not found: ${id}`);
  }

  sendSuccess(res, "SOS incident retrieved successfully", incident);

  // The incident carries the person's phone and location: looking is recorded, like opening a user's account.
  logActivity(req, {
    ...SOS_ACTIVITY,
    action: "sos.view",
    description: "Viewed an SOS incident",
    targetId: id,
  });
}

export async function adminUpdateIncidentStatus(req: Request, res: Response) {
  const adminId = callerId(req);
  const { id } = req.validated.params as { id: string };
  const input = req.validated.body as UpdateSosStatusInput;

  const existing = await sosIncidentModel.findById(id);
  if (!existing) {
    throw AppError.notFound(`SOS incident not found: ${id}`);
  }

  const incident = await sosIncidentModel.updateStatusByAdmin(id, adminId, input);
  if (!incident) {
    throw await refusal(
      id,
      (current) => `Can't move an SOS alert from ${current.status} to ${input.status}`,
    );
  }

  sendSuccess(res, "SOS incident status updated successfully", incident);

  // The person's status screen follows along live; other dispatchers see who moved it.
  emitToUser(incident.userId, "sos:statusChanged", statusChangeOf(incident));
  emitToSafetyDesk("sos:statusChanged", statusChangeOf(incident));
  void notifySos(incident.userId, { id: incident.id, status: incident.status });
  void sendSosEmail(incident.userId, incident.status);

  logActivity(req, {
    ...SOS_ACTIVITY,
    action: "sos.updateStatus",
    description: `Moved an SOS incident to ${input.status}`,
    targetId: id,
    before: existing,
    after: incident,
  });
}
