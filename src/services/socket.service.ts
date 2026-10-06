import type { Server } from "socket.io";
import { createLogger } from "../config/logger.js";
import { rolePermissionModel } from "../models/rolePermission.model.js";
import type { SocketData } from "../middlewares/socketAuthenticate.js";

const socketLogger = createLogger("socket");

// Set once, from index.ts, after the Socket.IO server is created. Stays undefined for the lifetime of the
// process in any context that never calls initSocketService — most importantly the test suite, which
// imports app.ts directly and never runs index.ts. emitToUser is a safe no-op in that case.
let io: Server | undefined;

export function initSocketService(server: Server): void {
  io = server;
}

// Fire-and-forget, same philosophy as logActivity: a broadcast failing or being unavailable must never
// break the request that triggered it. Controllers call this after sending their response, same placement
// convention as logActivity(req, ...).
export function emitToUser(userId: string, event: string, payload?: unknown): void {
  if (!io) {
    socketLogger.debug({ userId, event }, "Socket.IO not initialized — skipping emit");
    return;
  }
  try {
    io.to(`user:${userId}`).emit(event, payload);
  } catch (err) {
    socketLogger.error({ err, userId, event }, "Failed to emit socket event");
  }
}

// Admins who can read the sos module (the permission behind the SOS dispatch queue) join this room to be alerted the moment
// an emergency is raised, cancelled or moved on. Rooms are only joined at connect time, so a role change applies
// the next time the admin connects (access tokens last 15 minutes, so apps reconnect often).
export const SAFETY_DESK_ROOM = "admin:safety";

function emitToRoom(room: string, event: string, payload?: unknown): void {
  if (!io) {
    socketLogger.debug({ event }, "Socket.IO not initialized — skipping emit");
    return;
  }
  try {
    io.to(room).emit(event, payload);
  } catch (err) {
    socketLogger.error({ err, event }, "Failed to emit socket event");
  }
}

export function emitToSafetyDesk(event: string, payload?: unknown): void {
  emitToRoom(SAFETY_DESK_ROOM, event, payload);
}

// Admins who can read the reports module join this room to see trip reports arrive and move, the same way as
// the safety desk above.
export const REPORTS_DESK_ROOM = "admin:reports";

export function emitToReportsDesk(event: string, payload?: unknown): void {
  emitToRoom(REPORTS_DESK_ROOM, event, payload);
}

// Admins who can read the support module join this room to see tickets, messages and typing as they happen.
export const SUPPORT_DESK_ROOM = "admin:support";

export function emitToSupportDesk(event: string, payload?: unknown): void {
  emitToRoom(SUPPORT_DESK_ROOM, event, payload);
}

// Every account joins its own room; an active admin also joins the desk of each of sos, reports and support it
// can read.
export async function joinSocketRooms(socket: {
  data: SocketData;
  join: (room: string) => unknown;
}): Promise<void> {
  const { userId, userType } = socket.data;
  socket.join(`user:${userId}`);

  if (userType === "admin") {
    const permissions = await rolePermissionModel.findForActiveAdmin(userId);
    if (permissions.sos?.read) {
      socket.join(SAFETY_DESK_ROOM);
    }
    if (permissions.reports?.read) {
      socket.join(REPORTS_DESK_ROOM);
    }
    if (permissions.support?.read) {
      socket.join(SUPPORT_DESK_ROOM);
    }
  }
}
