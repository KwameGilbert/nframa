import { z } from "zod";

const ratingSchema = z
  .number()
  .int()
  .min(1)
  .max(5)
  .meta({ description: "Star rating, 1 to 5", example: 5 });

const commentSchema = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .meta({ description: "Written feedback", example: "Great driver! Very punctual and clean car." });

const tagsSchema = z
  .array(z.string().trim().min(1).max(50))
  .max(10)
  .meta({
    description: "Compliments or issues picked in the app",
    example: ["Punctual", "Clean Vehicle", "Smooth Driving"],
  });

export const createTripReviewSchema = z.object({
  rating: ratingSchema,
  comment: commentSchema.optional(),
  tags: tagsSchema.optional(),
  tip: z
    .number()
    .min(0)
    .max(1000)
    .refine((amount) => Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6, {
      message: "Tip must have at most 2 decimal places",
    })
    .default(0)
    .meta({
      description:
        "Optional tip in GHS, moved from the rider's wallet to the driver's. Riders only; the rider's available balance must cover it",
      example: 10,
    }),
});

export type CreateTripReviewInput = z.infer<typeof createTripReviewSchema>;

export const updateTripReviewSchema = z
  .object({ rating: ratingSchema, comment: commentSchema, tags: tagsSchema })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export type UpdateTripReviewInput = z.infer<typeof updateTripReviewSchema>;

export const tripReviewsParamsSchema = z.object({
  tripId: z.uuid().meta({ description: "The completed trip being reviewed" }),
});

export const reviewParamsSchema = z.object({
  id: z.uuid(),
});

export const userReviewsParamsSchema = z.object({
  userId: z.uuid().meta({ description: "The user who received the reviews" }),
});

export const listUserReviewsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).meta({ description: "Page number, from 1" }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(50)
    .default(20)
    .meta({ description: "Entries per page, 1-50 (default 20)" }),
});

export type ListUserReviewsQuery = z.infer<typeof listUserReviewsQuerySchema>;

// Responses (docs only — see CLAUDE.md "API docs").

export const tripReviewResponseSchema = z.object({
  id: z.uuid(),
  tripId: z.uuid(),
  reviewerUserId: z.uuid(),
  revieweeUserId: z.uuid(),
  reviewerRole: z.enum(["rider", "driver"]).meta({ description: "Who wrote it" }),
  rating: z.number().int().meta({ example: 5 }),
  comment: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  tip: z.number().meta({ description: "Tip given with the review, GHS", example: 10 }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const userReviewResponseSchema = tripReviewResponseSchema.extend({
  reviewerName: z.string().nullable().meta({
    description: "The reviewer's first name; admins see the full name",
    example: "Ama",
  }),
  reviewerAvatar: z.string().nullable(),
});

export const userReviewListResponseSchema = z.object({
  items: z.array(userReviewResponseSchema).meta({ description: "Newest first" }),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    totalItems: z.number().int(),
    totalPages: z.number().int(),
  }),
});

export const ratingSummaryResponseSchema = z.object({
  userId: z.uuid(),
  averageRating: z.number().meta({ description: "0 when there are no reviews", example: 4.88 }),
  totalReviews: z.number().int().meta({ example: 42 }),
  breakdown: z.object({
    star1: z.number().int(),
    star2: z.number().int(),
    star3: z.number().int(),
    star4: z.number().int(),
    star5: z.number().int(),
  }),
});
