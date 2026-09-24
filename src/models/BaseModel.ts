import db from "../database/knex.js";
import { AppError } from "../utils/AppError.js";

export abstract class BaseModel<T extends object> {
  protected abstract readonly tableName: string;
  protected readonly primaryKey: string = "id";
  protected readonly excludedColumns: string[] = [];

  protected get table() {
    return db(this.tableName);
  }

  private sanitize(row: T): T {
    if (this.excludedColumns.length === 0) return row;

    const clone = { ...row } as Record<string, unknown>;
    for (const column of this.excludedColumns) {
      delete clone[column];
    }
    return clone as T;
  }

  // Protected so subclasses writing their own queries (e.g. inside a transaction) map errors the same way.
  protected handleDbError(err: unknown): never {
    const code = (err as { code?: string }).code;

    if (code === "23505") {
      throw AppError.conflict(`A ${this.tableName} record with this value already exists`);
    }
    if (code === "23503") {
      throw AppError.badRequest("Referenced record does not exist");
    }

    throw err;
  }

  async findById(id: string): Promise<T | undefined> {
    const row = await this.table.where({ [this.primaryKey]: id }).first();
    return row && this.sanitize(row);
  }

  async findOne(criteria: Partial<T>): Promise<T | undefined> {
    const row = await this.table.where(criteria).first();
    return row && this.sanitize(row);
  }

  async findAllBy(criteria: Partial<T>): Promise<T[]> {
    const rows = await this.table.where(criteria);
    return rows.map((row: T) => this.sanitize(row));
  }

  async insert(input: Partial<T>): Promise<T> {
    try {
      const [row] = await this.table.insert(input).returning("*");
      return this.sanitize(row);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  async updateById(id: string, input: Partial<T>): Promise<T | undefined> {
    try {
      const [row] = await this.table
        .where({ [this.primaryKey]: id })
        .update(input)
        .returning("*");
      return row && this.sanitize(row);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  deleteById(id: string): Promise<number> {
    return this.table.where({ [this.primaryKey]: id }).del();
  }
}
