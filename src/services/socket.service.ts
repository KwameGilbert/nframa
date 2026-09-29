import type { Server } from "socket.io";
import { createLogger } from "../config/logger.js";

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
