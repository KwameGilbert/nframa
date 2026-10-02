import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import {
  createEmergencyContactSchema,
  emergencyContactParamsSchema,
  listEmergencyContactsQuerySchema,
  updateEmergencyContactSchema,
} from "../schemas/emergencyContact.schema.js";
import {
  createEmergencyContact,
  deleteEmergencyContact,
  getEmergencyContact,
  listEmergencyContacts,
  updateEmergencyContact,
} from "../controllers/emergencyContact.controller.js";

export const emergencyContactRouter = Router();

// Ownership is checked in the controller: for list and create it depends on the query/body, and for the
// rest it needs the loaded contact.
emergencyContactRouter.get(
  "/emergency-contacts",
  authenticate,
  validate({ query: listEmergencyContactsQuerySchema }),
  listEmergencyContacts,
);

emergencyContactRouter.post(
  "/emergency-contacts",
  authenticate,
  validate({ body: createEmergencyContactSchema }),
  createEmergencyContact,
);

emergencyContactRouter.get(
  "/emergency-contacts/:id",
  authenticate,
  validate({ params: emergencyContactParamsSchema }),
  getEmergencyContact,
);

emergencyContactRouter.patch(
  "/emergency-contacts/:id",
  authenticate,
  validate({ params: emergencyContactParamsSchema, body: updateEmergencyContactSchema }),
  updateEmergencyContact,
);

emergencyContactRouter.delete(
  "/emergency-contacts/:id",
  authenticate,
  validate({ params: emergencyContactParamsSchema }),
  deleteEmergencyContact,
);
