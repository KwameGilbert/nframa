import type { Knex } from "knex";
import { AppError } from "./AppError.js";

// Every status change on a money row is one guarded UPDATE: it only applies while the row is still in one of the
// expected statuses, so of two simultaneous changes one wins and the other gets a 409 instead of overwriting it.
export async function transition<T = Record<string, unknown>>(
  trx: Knex.Transaction,
  table: string,
  id: string,
  from: readonly string[],
  to: string,
  fields: Record<string, unknown> = {},
): Promise<T> {
  const [row] = await trx(table)
    .where({ id })
    .whereIn("status", from)
    .update({ ...fields, status: to, updatedAt: new Date() })
    .returning("*");
  if (!row) throw AppError.conflict(`Can't change to ${to}: it is no longer ${from.join(" or ")}`);
  return row as T;
}
