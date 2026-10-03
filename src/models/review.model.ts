import db from "../database/knex.js";
import { BaseModel } from "./BaseModel.js";
import { walletModel } from "./wallet.model.js";
import { AppError } from "../utils/AppError.js";
import type { UpdateTripReviewInput } from "../schemas/review.schema.js";

export interface TripReview {
  id: string;
  tripId: string;
  reviewerUserId: string;
  revieweeUserId: string;
  reviewerRole: "rider" | "driver";
  rating: number;
  comment: string | null;
  tags: string[] | null;
  tip: number;
  createdAt: Date;
  updatedAt: Date;
}

export type NewTripReview = Pick<
  TripReview,
  | "tripId"
  | "reviewerUserId"
  | "revieweeUserId"
  | "reviewerRole"
  | "rating"
  | "comment"
  | "tags"
  | "tip"
>;

// A review with its author, for lists.
export type TripReviewWithReviewer = TripReview & {
  reviewerFullName: string | null;
  reviewerAvatar: string | null;
};

const WITH_REVIEWER = [
  "tr.*",
  "r.fullName as reviewerFullName",
  "r.profilePicture as reviewerAvatar",
];

class ReviewModel extends BaseModel<TripReview> {
  protected readonly tableName = "tripReviews";

  // pg returns numeric columns as strings; clients get numbers.
  protected sanitize<R extends TripReview>(row: R): R {
    return { ...row, tip: Number(row.tip) };
  }

  findByTripAndReviewer(tripId: string, reviewerUserId: string) {
    return this.findOne({ tripId, reviewerUserId });
  }

  // The review and its tip commit together: a tip the rider can't cover leaves no review behind, and a refused
  // second review moves no money.
  async createReview(review: NewTripReview): Promise<TripReview> {
    try {
      return await db.transaction(async (trx) => {
        const [row] = await trx("tripReviews").insert(review).returning("*");
        if (review.tip > 0) {
          await walletModel.transferTip(trx, {
            fromUserId: review.reviewerUserId,
            toUserId: review.revieweeUserId,
            tripId: review.tripId,
            amount: review.tip,
          });
        }
        return this.sanitize(row);
      });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw AppError.conflict("You have already reviewed this trip");
      }
      throw err;
    }
  }

  // Only the review's content changes; the tip was paid when it was written.
  updateReview(id: string, input: UpdateTripReviewInput) {
    return this.updateById(id, { ...input, updatedAt: new Date() });
  }

  async listForTrip(tripId: string): Promise<TripReviewWithReviewer[]> {
    const rows = await db("tripReviews as tr")
      .join("users as r", "r.id", "tr.reviewerUserId")
      .where("tr.tripId", tripId)
      .orderBy([
        { column: "tr.createdAt", order: "asc" },
        { column: "tr.id", order: "asc" },
      ])
      .select(WITH_REVIEWER);
    return rows.map((row: TripReviewWithReviewer) => this.sanitize(row));
  }

  async listByReviewee(revieweeUserId: string, { page, limit }: { page: number; limit: number }) {
    const [counted, rows] = await Promise.all([
      db("tripReviews")
        .where({ revieweeUserId })
        .first(db.raw("count(*)::int as total")) as Promise<{ total: number }>,
      db("tripReviews as tr")
        .join("users as r", "r.id", "tr.reviewerUserId")
        .where("tr.revieweeUserId", revieweeUserId)
        .orderBy([
          { column: "tr.createdAt", order: "desc" },
          { column: "tr.id", order: "desc" },
        ])
        .limit(limit)
        .offset((page - 1) * limit)
        .select(WITH_REVIEWER) as Promise<TripReviewWithReviewer[]>,
    ]);
    return { totalItems: counted.total, items: rows.map((row) => this.sanitize(row)) };
  }

  async getRatingSummary(revieweeUserId: string) {
    const row = await db("tripReviews")
      .where({ revieweeUserId })
      .first(
        db.raw("count(*)::int as total"),
        db.raw("coalesce(round(avg(rating), 2), 0)::float8 as average"),
        db.raw("(count(*) filter (where rating = 1))::int as star1"),
        db.raw("(count(*) filter (where rating = 2))::int as star2"),
        db.raw("(count(*) filter (where rating = 3))::int as star3"),
        db.raw("(count(*) filter (where rating = 4))::int as star4"),
        db.raw("(count(*) filter (where rating = 5))::int as star5"),
      );
    return {
      userId: revieweeUserId,
      averageRating: row.average as number,
      totalReviews: row.total as number,
      breakdown: {
        star1: row.star1 as number,
        star2: row.star2 as number,
        star3: row.star3 as number,
        star4: row.star4 as number,
        star5: row.star5 as number,
      },
    };
  }
}

export const reviewModel = new ReviewModel();
