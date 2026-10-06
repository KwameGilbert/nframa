import { randomInt } from "node:crypto";
import db from "../../src/database/knex.js";
import { generateCode } from "../../src/utils/code.js";
import { trackForCleanup } from "./cleanup.js";

// A made-up word no ticket, message or category holds, so a test only ever finds its own rows.
export function uniqueWord(length = 10): string {
  let word = "";
  for (let i = 0; i < length; i++) word += String.fromCharCode(97 + randomInt(26));
  return word;
}

export async function seedCategory(over: Record<string, unknown> = {}) {
  const [row] = await db("supportCategories")
    .insert({ name: `Test ${uniqueWord()}`, ...over })
    .returning("*");
  trackForCleanup("supportCategories", { id: row.id });
  return row as { id: string; name: string; audience: string; defaultPriority: string };
}

// Straight to the database: tickets staff act on don't need to go through the (rate-limited) create route.
export async function seedTicket(userId: string, categoryId: string, over: Record<string, unknown> = {}) {
  const [row] = await db("supportTickets")
    .insert({
      code: generateCode("ST"),
      userId,
      raiserRole: "rider",
      categoryId,
      subject: `Help ${uniqueWord()}`,
      priority: "normal",
      ...over,
    })
    .returning("*");
  trackForCleanup("supportTickets", { id: row.id });
  return row as { id: string; code: string; status: string };
}

// A message straight to the database (cascades with its ticket). Notes are internal, as the table requires.
export async function seedMessage(
  ticketId: string,
  over: Partial<{
    senderSide: "user" | "staff";
    senderUserId: string | null;
    kind: "message" | "note";
    body: string | null;
    attachments: unknown[];
    createdAt: Date;
    deletedAt: Date;
    deletedBySide: "user" | "staff";
  }> = {},
) {
  const { attachments = [], kind = "message", ...rest } = over;
  const [row] = await db("supportTicketMessages")
    .insert({
      ticketId,
      senderSide: "staff",
      body: `Reply ${uniqueWord()}`,
      kind,
      internal: kind === "note",
      attachments: JSON.stringify(attachments),
      ...rest,
    })
    .returning(["id", "seq", "body"]);
  return row as { id: string; seq: number; body: string };
}
