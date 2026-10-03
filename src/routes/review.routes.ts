import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requirePermission } from "../middlewares/authorize.js";
import {
  createTripReviewSchema,
  listUserReviewsQuerySchema,
  reviewParamsSchema,
  tripReviewsParamsSchema,
  updateTripReviewSchema,
  userReviewsParamsSchema,
} from "../schemas/review.schema.js";
import {
  createTripReview,
  deleteTripReview,
  getTripReviews,
  getUserRatingSummary,
  getUserReviews,
  updateTripReview,
} from "../controllers/review.controller.js";

export const reviewRouter = Router();

// Who may do what depends on who was on the trip or wrote the review, so the controller checks it.
reviewRouter.post(
  "/trips/:tripId/reviews",
  authenticate,
  validate({ params: tripReviewsParamsSchema, body: createTripReviewSchema }),
  createTripReview,
);

reviewRouter.get(
  "/trips/:tripId/reviews",
  authenticate,
  validate({ params: tripReviewsParamsSchema }),
  getTripReviews,
);

reviewRouter.patch(
  "/reviews/:id",
  authenticate,
  validate({ params: reviewParamsSchema, body: updateTripReviewSchema }),
  updateTripReview,
);

// Moderation: removes a review for everyone.
reviewRouter.delete(
  "/reviews/:id",
  authenticate,
  requirePermission("users", "delete"),
  validate({ params: reviewParamsSchema }),
  deleteTripReview,
);

reviewRouter.get(
  "/users/:userId/reviews",
  authenticate,
  validate({ params: userReviewsParamsSchema, query: listUserReviewsQuerySchema }),
  getUserReviews,
);

reviewRouter.get(
  "/users/:userId/ratings/summary",
  authenticate,
  validate({ params: userReviewsParamsSchema }),
  getUserRatingSummary,
);
