import type { Socket } from "socket.io";
import { z, ZodError } from "zod";
import { createLogger } from "../config/logger.js";
import type { SocketData } from "../middlewares/socketAuthenticate.js";
import { rolePermissionModel } from "../models/rolePermission.model.js";
import { supportTicketModel, type SupportTicket } from "../models/supportTicket.model.js";
import { userModel } from "../models/user.model.js";
import { emitToSupportDesk, emitToUser } from "./socket.service.js";
import { announceMessage, announceRead, postTicketMessage, ticketNotFound } from "./support.service.js";
import { firstName, staffMessageView, staffTicketView, userMessageView, userTicketView } from "./supportViews.js";
import { AppError } from "../utils/AppError.js";

// The socket twin of the chat routes: text messages and notes, read markers and typing, for both sides. Files and
// deletes stay HTTP-only (uploads are too big for a socket; deletes are audited, which needs the HTTP request).
export type Ack = (reply: { ok: true; data: unknown } | { ok: false; error: string; status: number }) => void;

export interface ClientToServerEvents {
  "support:send": (payload: unknown, ack?: Ack) => void;
  "support:read": (payload: unknown, ack?: Ack) => void;
  "support:typing": (payload: unknown) => void;
}

type SupportSocket = Socket<ClientToServerEvents, Record<string, never>, Record<string, never>, SocketData>;

const logger = createLogger("socket");

const sendSchema = z.object({
  ticketId: z.uuid(),
  body: z.string().trim().min(1).max(4000),
  replyToMessageId: z.uuid().optional(),
  internal: z.boolean().optional(), // staff only: a note
});
const readSchema = z.object({ ticketId: z.uuid() });
const typingSchema = z.object({ ticketId: z.uuid(), isTyping: z.boolean(), internal: z.boolean().optional() });

// Per account across all its sockets, like the HTTP limiters (which never see socket traffic).
const LIMITS = { send: 120, read: 300 } as const;
const WINDOW_MS = 15 * 60_000;
const counters = new Map<string, { count: number; resetAt: number }>();

function allow(userId: string, event: keyof typeof LIMITS) {
  const key = `${event}:${userId}`;
  const now = Date.now();
  if (counters.size > 10_000) {
    for (const [k, v] of counters) if (v.resetAt <= now) counters.delete(k);
  }
  const entry = counters.get(key);
  if (!entry || entry.resetAt <= now) {
    counters.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  if (++entry.count > LIMITS[event]) throw new AppError("Too many requests, try again later", 429);
}

// Who is acting on which ticket, checked on every event: a role change or a recycled number applies at once.
async function actorFor(socket: SupportSocket, ticketId: string, need: "read" | "update") {
  const { userId, userType, role } = socket.data;
  let ticket: SupportTicket | undefined;
  if (userType === "admin") {
    const permissions = await rolePermissionModel.findForActiveAdmin(userId);
    if (!permissions.support?.[need]) throw AppError.forbidden(`Missing permission: ${need} on support`);
    ticket = await supportTicketModel.findById(ticketId);
  } else {
    if (role !== "rider" && role !== "driver") throw AppError.forbidden("Only riders and drivers can use support tickets");
    ticket = await supportTicketModel.findOwned(ticketId, userId);
  }
  if (!ticket) throw ticketNotFound(ticketId);
  return { ticket, userId, side: userType === "admin" ? ("staff" as const) : ("user" as const) };
}

const zodMessage = (err: ZodError) =>
  err.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");

// Never lets a handler reject (an unhandled rejection exits the process); the ack carries the outcome.
function handle(socket: SupportSocket, run: (payload: unknown) => Promise<unknown>) {
  return (payload: unknown, ack?: Ack) => {
    void (async () => {
      let reply: Parameters<Ack>[0];
      try {
        reply = { ok: true, data: await run(payload) };
      } catch (err) {
        if (err instanceof ZodError) reply = { ok: false, error: zodMessage(err), status: 400 };
        else if (err instanceof AppError && err.statusCode < 500) {
          reply = { ok: false, error: err.message, status: err.statusCode };
        } else {
          logger.error({ err, userId: socket.data.userId }, "Support socket event failed");
          reply = { ok: false, error: "Internal server error", status: 500 };
        }
      }
      try {
        if (typeof ack === "function") ack(reply);
      } catch (err) {
        logger.warn({ err }, "Support socket ack failed");
      }
    })();
  };
}

const TYPING_THROTTLE_MS = 3_000;

export function registerSupportSocket(socket: SupportSocket) {
  socket.on(
    "support:send",
    handle(socket, async (payload) => {
      allow(socket.data.userId, "send");
      const input = sendSchema.parse(payload);
      const { ticket, userId, side } = await actorFor(socket, input.ticketId, "update");
      const userName = side === "staff" ? ((await userModel.findById(userId))?.fullName ?? null) : null;
      const kind = side === "staff" && input.internal ? "note" : "message";
      const posted = await postTicketMessage(ticket, { side, userId, userName, kind }, input, []);

      announceMessage(posted);
      return side === "staff"
        ? { message: staffMessageView(posted.message), ticket: staffTicketView(posted.ticket) }
        : { message: userMessageView(posted.message), ticket: userTicketView(posted.ticket) };
    }),
  );

  socket.on(
    "support:read",
    handle(socket, async (payload) => {
      allow(socket.data.userId, "read");
      const { ticketId } = readSchema.parse(payload);
      const { ticket, userId, side } = await actorFor(socket, ticketId, "read");
      const lastReadSeq =
        (await supportTicketModel.markRead(ticket.id, side, side === "user" ? userId : undefined)) ?? 0;

      announceRead(ticket, side, lastReadSeq);
      return { lastReadSeq };
    }),
  );

  // Fire-and-forget: invalid or unauthorised typing is dropped silently. One "typing" per ticket per 3 seconds per
  // socket; "stopped" only after a "typing" this socket actually relayed.
  const typingSince = new Map<string, number>();
  socket.on(
    "support:typing",
    handle(socket, async (payload) => {
      const parsed = typingSchema.safeParse(payload);
      if (!parsed.success) return;
      const { ticketId, isTyping, internal = false } = parsed.data;
      const last = typingSince.get(ticketId);
      if (isTyping ? last !== undefined && Date.now() - last < TYPING_THROTTLE_MS : last === undefined) return;

      const { ticket, userId, side } = await actorFor(socket, ticketId, "update");
      if (ticket.status === "closed" || ticket.detachedAt) return;
      if (isTyping) typingSince.set(ticketId, Date.now());
      else typingSince.delete(ticketId);

      if (side === "user") {
        emitToSupportDesk("support:typing", { ticketId, side, isTyping });
        return;
      }
      const name = (await userModel.findById(userId))?.fullName ?? null;
      emitToSupportDesk("support:typing", { ticketId, side, userId, name, isTyping, internal });
      if (!internal) emitToUser(ticket.userId, "support:typing", { ticketId, side, name: firstName(name), isTyping });
    }),
  );
}
