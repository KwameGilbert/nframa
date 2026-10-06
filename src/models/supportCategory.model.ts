import db from "../database/knex.js";
import { AppError } from "../utils/AppError.js";
import { isUniqueViolation } from "../utils/dbErrors.js";
import { BaseModel } from "./BaseModel.js";
import type { SupportPriority } from "../schemas/supportCategory.schema.js";

export interface SupportCategory {
  id: string;
  name: string;
  description: string | null;
  audience: "all" | "rider" | "driver";
  defaultPriority: SupportPriority;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export type AdminSupportCategory = SupportCategory & { ticketCount: number };

const ORDER = [
  { column: "sortOrder", order: "asc" },
  { column: "name", order: "asc" },
] as const;

export function publicSupportCategory({ id, name, description }: SupportCategory) {
  return { id, name, description };
}

class SupportCategoryModel extends BaseModel<SupportCategory> {
  protected readonly tableName = "supportCategories";

  private duplicate(err: unknown, name: string | undefined): never {
    if (isUniqueViolation(err, "supportCategories_name_unique")) {
      throw AppError.conflict(`A support category named "${name}" already exists`);
    }
    this.handleDbError(err);
  }

  // What a user may file under: active, and meant for everyone or for their role.
  listForAudience(role: "rider" | "driver" | null): Promise<SupportCategory[]> {
    const query = this.table.where({ isActive: true }).orderBy([...ORDER]);
    if (role) query.whereIn("audience", ["all", role]);
    return query;
  }

  async listWithCounts(id?: string): Promise<AdminSupportCategory[]> {
    const query = db("supportCategories as c")
      .select("c.*", db.raw(`(SELECT count(*)::int FROM "supportTickets" t WHERE t."categoryId" = c.id) AS "ticketCount"`))
      .orderBy([
        { column: "c.sortOrder", order: "asc" },
        { column: "c.name", order: "asc" },
      ]);
    if (id) query.where("c.id", id);
    return query;
  }

  async findWithCount(id: string): Promise<AdminSupportCategory | undefined> {
    const [row] = await this.listWithCounts(id);
    return row;
  }

  async create(input: Partial<SupportCategory>): Promise<SupportCategory> {
    try {
      const [row] = await this.table.insert(input).returning("*");
      return row;
    } catch (err) {
      this.duplicate(err, input.name);
    }
  }

  async update(id: string, input: Partial<SupportCategory>): Promise<SupportCategory | undefined> {
    try {
      const [row] = await this.table
        .where({ id })
        .update({ ...input, updatedAt: db.fn.now() })
        .returning("*");
      return row;
    } catch (err) {
      this.duplicate(err, input.name);
    }
  }

  // The FK (RESTRICT) is the final judge: a ticket filed between the caller's count and this delete still blocks it.
  async remove(id: string): Promise<"deleted" | "inUse"> {
    try {
      await this.table.where({ id }).del();
      return "deleted";
    } catch (err) {
      if ((err as { code?: string }).code === "23503") return "inUse";
      throw err;
    }
  }
}

export const supportCategoryModel = new SupportCategoryModel();
