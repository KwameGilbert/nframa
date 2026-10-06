import type { Request, Response } from "express";
import {
  publicSupportCategory,
  supportCategoryModel,
  type AdminSupportCategory,
} from "../models/supportCategory.model.js";
import { logActivity } from "../services/activityLog.service.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import type {
  CreateSupportCategoryInput,
  UpdateSupportCategoryInput,
} from "../schemas/supportCategory.schema.js";

const CATEGORY_ACTIVITY = { module: "support", targetType: "supportCategory" } as const;

async function findCategoryOrThrow(id: string): Promise<AdminSupportCategory> {
  const category = await supportCategoryModel.findWithCount(id);
  if (!category) {
    throw AppError.notFound(`Support category not found: ${id}`);
  }
  return category;
}

function inUse(count: number) {
  return AppError.conflict(
    `This category is used by ${count} ticket${count === 1 ? "" : "s"}; deactivate it instead`,
  );
}

// Riders and drivers see what they can file under; staff calling it see every active category.
export async function listSupportCategories(req: Request, res: Response) {
  const role = req.auth?.role === "rider" || req.auth?.role === "driver" ? req.auth.role : null;
  const categories = await supportCategoryModel.listForAudience(role);

  sendSuccess(res, "Support categories retrieved successfully", categories.map(publicSupportCategory));
}

export async function adminListSupportCategories(_req: Request, res: Response) {
  sendSuccess(res, "Support categories retrieved successfully", await supportCategoryModel.listWithCounts());
}

export async function createSupportCategory(req: Request, res: Response) {
  const input = req.validated.body as CreateSupportCategoryInput;

  const created = await supportCategoryModel.create(input);
  const category = await findCategoryOrThrow(created.id);

  sendCreated(res, "Support category created successfully", category);

  logActivity(req, {
    ...CATEGORY_ACTIVITY,
    action: "supportCategory.create",
    description: `Created the support category "${category.name}"`,
    targetId: category.id,
    after: category,
  });
}

export async function updateSupportCategory(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };
  const input = req.validated.body as UpdateSupportCategoryInput;

  const before = await findCategoryOrThrow(id);
  await supportCategoryModel.update(id, input);
  const after = await findCategoryOrThrow(id);

  sendSuccess(res, "Support category updated successfully", after);

  logActivity(req, {
    ...CATEGORY_ACTIVITY,
    action: "supportCategory.update",
    description: `Updated the support category "${after.name}"`,
    targetId: id,
    before,
    after,
  });
}

export async function deleteSupportCategory(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const category = await findCategoryOrThrow(id);
  if (category.ticketCount > 0) {
    throw inUse(category.ticketCount);
  }
  if ((await supportCategoryModel.remove(id)) === "inUse") {
    throw inUse((await findCategoryOrThrow(id)).ticketCount);
  }

  sendSuccess(res, "Support category deleted successfully");

  logActivity(req, {
    ...CATEGORY_ACTIVITY,
    action: "supportCategory.delete",
    description: `Deleted the support category "${category.name}"`,
    targetId: id,
    before: category,
  });
}
