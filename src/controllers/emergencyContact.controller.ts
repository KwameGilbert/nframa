import type { Request, Response } from "express";
import { emergencyContactModel } from "../models/emergencyContact.model.js";
import { assertSelfOrPermission } from "../middlewares/authorize.js";
import { logActivity } from "../services/activityLog.service.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import type {
  CreateEmergencyContactInput,
  ListEmergencyContactsQuery,
  UpdateEmergencyContactInput,
} from "../schemas/emergencyContact.schema.js";

const CONTACT_ACTIVITY = { module: "users", targetType: "emergencyContact" } as const;

function callerId(req: Request) {
  if (!req.auth) {
    throw AppError.unauthorized();
  }

  return req.auth.id;
}

// Loads the contact and checks the caller owns it (or has the admin permission) — the owner isn't in the
// request, so this can't be done in route middleware.
async function findContactFor(req: Request, id: string, action: "read" | "update" | "delete") {
  const contact = await emergencyContactModel.findById(id);

  if (!contact) {
    throw AppError.notFound(`Emergency contact not found: ${id}`);
  }
  await assertSelfOrPermission(req, contact.userId, "users", action);

  return contact;
}

export async function listEmergencyContacts(req: Request, res: Response) {
  const query = req.validated.query as ListEmergencyContactsQuery;
  const ownerId = query.userId ?? callerId(req);

  await assertSelfOrPermission(req, ownerId, "users", "read");

  const contacts = await emergencyContactModel.listForUser(ownerId);

  sendSuccess(res, "Emergency contacts retrieved successfully", contacts);
}

export async function createEmergencyContact(req: Request, res: Response) {
  const input = req.validated.body as CreateEmergencyContactInput;
  const { userId, ...fields } = input;
  const ownerId = userId ?? callerId(req);

  await assertSelfOrPermission(req, ownerId, "users", "create");

  const contact = await emergencyContactModel.createContact(fields, ownerId);

  sendCreated(res, "Emergency contact created successfully", contact);

  logActivity(req, {
    ...CONTACT_ACTIVITY,
    action: "emergencyContact.create",
    description: "Added an emergency contact",
    targetId: contact.id,
    after: contact,
  });
}

export async function getEmergencyContact(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const contact = await findContactFor(req, id, "read");

  sendSuccess(res, "Emergency contact retrieved successfully", contact);
}

export async function updateEmergencyContact(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };
  const input = req.validated.body as UpdateEmergencyContactInput;

  const existing = await findContactFor(req, id, "update");
  const contact = await emergencyContactModel.updateContact(id, input);

  if (!contact) {
    throw AppError.notFound(`Emergency contact not found: ${id}`);
  }

  sendSuccess(res, "Emergency contact updated successfully", contact);

  logActivity(req, {
    ...CONTACT_ACTIVITY,
    action: "emergencyContact.update",
    description: "Updated an emergency contact",
    targetId: id,
    before: existing,
    after: contact,
  });
}

export async function deleteEmergencyContact(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const existing = await findContactFor(req, id, "delete");
  await emergencyContactModel.deleteById(id);

  sendSuccess(res, "Emergency contact deleted successfully");

  logActivity(req, {
    ...CONTACT_ACTIVITY,
    action: "emergencyContact.delete",
    description: "Deleted an emergency contact",
    targetId: id,
    before: existing,
  });
}
