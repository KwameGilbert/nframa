import { errorResponse, registry, successResponse } from "./registry.js";
import {
  createRiderProfileSchema,
  riderProfileParamsSchema,
  riderProfileResponseSchema,
} from "../schemas/riderProfile.schema.js";

registry.registerPath({
  method: "post",
  path: "/rider",
  tags: ["Rider Profiles"],
  summary: "Create a rider profile (for yourself, or anyone with users: create)",
  description:
    "Creates the rider record that booking needs: POST /trips answers 400 with the message Create your rider profile before requesting trips until it exists, so a rider creates it right after signing up (the profile on the signed-in user, from login or GET /auth/me, is null until then). userId must be the caller's own id, otherwise the caller needs users: create (403), and it must be an existing user (400). Each user can have one profile (409). The profile holds only userId and createdAt: there are no rider fields to fill in, and no route to update or delete it. Returns the new profile and is recorded in the audit trail.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: createRiderProfileSchema } },
    },
  },
  responses: {
    201: successResponse("Rider profile created successfully", riderProfileResponseSchema),
    400: errorResponse("Validation error, or userId doesn't match an existing user"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("userId isn't the caller and the caller lacks users: create"),
    409: errorResponse("Rider profile already exists for this user"),
  },
});

registry.registerPath({
  method: "get",
  path: "/rider/{userId}",
  tags: ["Rider Profiles"],
  summary: "Get a rider profile by user id (the rider themselves, or an admin with users: read)",
  description:
    "Returns the rider profile, which holds only userId and createdAt; use GET /users/{id} for the rider's name, phone and the rest. A rider can read only their own profile; anyone else needs users: read and gets 403, even for an id that has no rider profile. 404 means the user id has no rider profile, for example a driver's id or a rider who hasn't called POST /rider yet. A staff member viewing someone else's profile is recorded in the audit trail; reading your own isn't.",
  security: [{ bearerAuth: [] }],
  request: {
    params: riderProfileParamsSchema,
  },
  responses: {
    200: successResponse("Rider profile retrieved successfully", riderProfileResponseSchema),
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller isn't this rider and lacks users: read"),
    404: errorResponse(
      "Rider profile not found",
      "Rider profile not found for user: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
    ),
  },
});
