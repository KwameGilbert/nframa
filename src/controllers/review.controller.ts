import type { Request, Response } from "express";
import {
  reviewModel,
  type TripReview,
  type TripReviewWithReviewer,
} from "../models/review.model.js";
import { tripModel } from "../models/trip.model.js";
import { assertPermission, assertSelfOrPermission } from "../middlewares/authorize.js";
import { logActivity } from "../services/activityLog.service.js";
import { sendReviewEmail } from "../services/email.service.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import { findUserOrThrow } from "./user.controller.js";
import type {
  CreateTripReviewInput,
  ListUserReviewsQuery,
  UpdateTripReviewInput,
} from "../schemas/review.schema.js";

const REVIEW_ACTIVITY = { module: "trips", targetType: "review" } as const;

function callerId(req: Request) {
  if (!req.auth) {
    throw AppError.unauthorized();
  }

  return req.auth.id;
}

async function findReviewOrThrow(id: string) {
  const review = await reviewModel.findById(id);

  if (!review) {
    throw AppError.notFound(`Review not found: ${id}`);
  }

  return review;
}

// Loads a trip for one of its two people, or an admin with trips: read. Stale trips are settled first, so a boarded
// trip nobody completed shows as the completed trip it has become.
async function findTripForPerson(tripId: string) {
  await tripModel.settleStale({ id: tripId });
  const trip = await tripModel.findById(tripId);

  if (!trip) {
    throw AppError.notFound(`Trip not found: ${tripId}`);
  }

  return trip;
}

const firstName = (fullName: string | null) => fullName?.trim().split(/\s+/)[0] || null;

// Riders see a driver's reviewers by first name only; admins see the full name.
function userReviewView(
  { reviewerFullName, reviewerAvatar, ...review }: TripReviewWithReviewer,
  fullNames: boolean,
) {
  return {
    ...review,
    reviewerName: fullNames ? reviewerFullName : firstName(reviewerFullName),
    reviewerAvatar,
  };
}

export async function createTripReview(req: Request, res: Response) {
  const { tripId } = req.validated.params as { tripId: string };
  const input = req.validated.body as CreateTripReviewInput;
  const reviewerUserId = callerId(req);

  const trip = await findTripForPerson(tripId);
  const isRider = trip.riderUserId === reviewerUserId;
  if (!isRider && trip.driverUserId !== reviewerUserId) {
    throw AppError.forbidden("Only the trip's rider or driver can review it");
  }
  if (trip.status !== "completed") {
    throw AppError.conflict(`Can't review a trip that is ${trip.status}`);
  }
  if (input.tip > 0 && !isRider) {
    throw AppError.badRequest("Only the rider can tip");
  }
  if (await reviewModel.findByTripAndReviewer(tripId, reviewerUserId)) {
    throw AppError.conflict("You have already reviewed this trip");
  }

  const review = await reviewModel.createReview({
    tripId,
    reviewerUserId,
    revieweeUserId: isRider ? trip.driverUserId : trip.riderUserId,
    reviewerRole: isRider ? "rider" : "driver",
    rating: input.rating,
    comment: input.comment ?? null,
    tags: input.tags ?? null,
    tip: input.tip,
  });

  sendCreated(res, "Review created successfully", review);
  void sendReviewEmail(review.revieweeUserId, review.rating, review.tip);

  logActivity(req, {
    ...REVIEW_ACTIVITY,
    action: "review.create",
    description: input.tip > 0 ? "Reviewed a trip and tipped the driver" : "Reviewed a trip",
    targetId: review.id,
    after: review,
  });
}

export async function getTripReviews(req: Request, res: Response) {
  const { tripId } = req.validated.params as { tripId: string };

  const trip = await findTripForPerson(tripId);
  const caller = callerId(req);
  if (caller !== trip.riderUserId && caller !== trip.driverUserId) {
    await assertPermission(req, "trips", "read");
  }

  const reviews = await reviewModel.listForTrip(tripId);

  sendSuccess(
    res,
    "Trip reviews retrieved successfully",
    reviews.map((review) => userReviewView(review, req.auth?.role === "admin")),
  );
}

export async function updateTripReview(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };
  const input = req.validated.body as UpdateTripReviewInput;

  const existing = await findReviewOrThrow(id);
  if (existing.reviewerUserId !== callerId(req)) {
    throw AppError.forbidden("Only the reviewer can edit this review");
  }
  const review = (await reviewModel.updateReview(id, input)) as TripReview;

  sendSuccess(res, "Review updated successfully", review);

  logActivity(req, {
    ...REVIEW_ACTIVITY,
    action: "review.update",
    description: "Edited a review",
    targetId: id,
    before: existing,
    after: review,
  });
}

export async function getUserReviews(req: Request, res: Response) {
  const { userId } = req.validated.params as { userId: string };
  const query = req.validated.query as ListUserReviewsQuery;

  await findUserOrThrow(userId);
  await assertSelfOrPermission(req, userId, "users", "read");

  const { items, totalItems } = await reviewModel.listByReviewee(userId, query);

  sendSuccess(res, "Reviews retrieved successfully", {
    items: items.map((review) => userReviewView(review, req.auth?.role === "admin")),
    pagination: {
      page: query.page,
      limit: query.limit,
      totalItems,
      totalPages: Math.ceil(totalItems / query.limit),
    },
  });
}

// A driver's rating is public (riders see it when choosing a ride); a rider's is for the rider and admins.
export async function getUserRatingSummary(req: Request, res: Response) {
  const { userId } = req.validated.params as { userId: string };

  const user = await findUserOrThrow(userId);
  if (user.role !== "driver") {
    await assertSelfOrPermission(req, userId, "users", "read");
  }

  sendSuccess(res, "Rating summary retrieved successfully", await reviewModel.getRatingSummary(userId));
}

export async function deleteTripReview(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const existing = await findReviewOrThrow(id);
  await reviewModel.deleteById(id);

  sendSuccess(res, "Review deleted successfully");

  logActivity(req, {
    ...REVIEW_ACTIVITY,
    action: "review.delete",
    description: "Deleted a review",
    targetId: id,
    before: existing,
  });
}
