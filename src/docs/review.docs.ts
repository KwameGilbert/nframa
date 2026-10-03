import { errorResponse, registry, successResponse } from "./registry.js";
import {
  createTripReviewSchema,
  listUserReviewsQuerySchema,
  ratingSummaryResponseSchema,
  reviewParamsSchema,
  tripReviewResponseSchema,
  tripReviewsParamsSchema,
  updateTripReviewSchema,
  userReviewListResponseSchema,
  userReviewResponseSchema,
  userReviewsParamsSchema,
} from "../schemas/review.schema.js";
import { z } from "zod";

const unauthorized = errorResponse("Missing or invalid access token");
const TRIP_ID = "7c1e9a52-3b4d-4f6e-8a90-1b2c3d4e5f60";
const REVIEW_ID = "9d4e2b71-5c3a-4f80-b6d2-0a1e7c9f3b58";
const USER_ID = "3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34";
const tripNotFound = errorResponse("No trip has this id", `Trip not found: ${TRIP_ID}`);
const reviewNotFound = errorResponse("No review has this id", `Review not found: ${REVIEW_ID}`);
const userNotFound = errorResponse("No user has this id", `User not found: ${USER_ID}`);

registry.registerPath({
  method: "post",
  path: "/trips/{tripId}/reviews",
  tags: ["Reviews"],
  summary: "Review a completed trip (its rider or its driver)",
  description:
    "The rider reviews the driver and the driver reviews the rider, once each per trip. Only a completed trip can be reviewed. A rider can add a tip (tip): it is moved from their wallet to the driver's in the same step as the review (two `tip` ledger rows), and fails with 409 if their available balance doesn't cover it, in which case no review is saved. Drivers can't tip.",
  security: [{ bearerAuth: [] }],
  request: {
    params: tripReviewsParamsSchema,
    body: { content: { "application/json": { schema: createTripReviewSchema } } },
  },
  responses: {
    201: successResponse("Review created successfully", tripReviewResponseSchema),
    400: errorResponse("Validation error, or a driver sent a tip", "Only the rider can tip"),
    401: unauthorized,
    403: errorResponse(
      "The caller wasn't the trip's rider or driver",
      "Only the trip's rider or driver can review it",
    ),
    404: tripNotFound,
    409: errorResponse(
      "The trip isn't completed, the caller already reviewed it, or the rider can't cover the tip",
      "You have already reviewed this trip",
    ),
  },
});

registry.registerPath({
  method: "get",
  path: "/trips/{tripId}/reviews",
  tags: ["Reviews"],
  summary: "Get a trip's reviews (its rider or driver, or an admin with trips: read)",
  description: "Both directions, oldest first: at most one from the rider and one from the driver.",
  security: [{ bearerAuth: [] }],
  request: { params: tripReviewsParamsSchema },
  responses: {
    200: successResponse("Trip reviews retrieved successfully", z.array(userReviewResponseSchema)),
    400: errorResponse("Invalid trip id"),
    401: unauthorized,
    403: errorResponse(
      "Not on this trip and lacking trips: read",
      "Missing permission: read on trips",
    ),
    404: tripNotFound,
  },
});

registry.registerPath({
  method: "patch",
  path: "/reviews/{id}",
  tags: ["Reviews"],
  summary: "Edit your review",
  description:
    "Only the reviewer can edit, and only the rating, comment and tags. The tip was paid with the review and can't change.",
  security: [{ bearerAuth: [] }],
  request: {
    params: reviewParamsSchema,
    body: { content: { "application/json": { schema: updateTripReviewSchema } } },
  },
  responses: {
    200: successResponse("Review updated successfully", tripReviewResponseSchema),
    400: errorResponse("Validation error, or no fields provided"),
    401: unauthorized,
    403: errorResponse("Not the reviewer", "Only the reviewer can edit this review"),
    404: reviewNotFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/reviews/{id}",
  tags: ["Reviews"],
  summary: "Delete a review (moderation, admins with users: delete)",
  description: "Removes the review for everyone. A tip that came with it is not refunded.",
  security: [{ bearerAuth: [] }],
  request: { params: reviewParamsSchema },
  responses: {
    200: successResponse("Review deleted successfully"),
    400: errorResponse("Invalid review id"),
    401: unauthorized,
    403: errorResponse("Caller lacks users: delete", "Missing permission: delete on users"),
    404: reviewNotFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/users/{userId}/reviews",
  tags: ["Reviews"],
  summary: "List reviews a user received (the user themselves, or an admin with users: read)",
  description:
    "Newest first. Each entry has the reviewer's first name and avatar; admins see the full name.",
  security: [{ bearerAuth: [] }],
  request: { params: userReviewsParamsSchema, query: listUserReviewsQuerySchema },
  responses: {
    200: successResponse("Reviews retrieved successfully", userReviewListResponseSchema),
    400: errorResponse("Invalid user id or query"),
    401: unauthorized,
    403: errorResponse(
      "Not this user and lacking users: read",
      "Missing permission: read on users",
    ),
    404: userNotFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/users/{userId}/ratings/summary",
  tags: ["Reviews"],
  summary: "Get a user's average rating and star breakdown",
  description:
    "A driver's rating is visible to any signed-in user. A rider's is only for the rider themselves or an admin with users: read.",
  security: [{ bearerAuth: [] }],
  request: { params: userReviewsParamsSchema },
  responses: {
    200: successResponse("Rating summary retrieved successfully", ratingSummaryResponseSchema),
    400: errorResponse("Invalid user id"),
    401: unauthorized,
    403: errorResponse(
      "A rider's summary, and the caller isn't that rider and lacks users: read",
      "Missing permission: read on users",
    ),
    404: userNotFound,
  },
});
