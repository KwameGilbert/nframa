import { config } from "dotenv";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { createLogger } from "./config/logger.js";
import { app } from "./app.js";
import { socketAuthenticate, type SocketData } from "./middlewares/socketAuthenticate.js";
import { initSocketService, joinSocketRooms } from "./services/socket.service.js";
import { startPushReceiptSweep } from "./services/pushReceipts.service.js";
import { startEarningsReleaseSweep } from "./services/earningsRelease.service.js";
import {
  registerSupportSocket,
  type ClientToServerEvents,
} from "./services/supportSocket.service.js";

config();

// Initialize process-level error handling
const processLogger = createLogger("process");

process.on("uncaughtException", (err) => {
  processLogger.fatal({ err }, "Uncaught exception");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  processLogger.fatal({ err: reason }, "Unhandled rejection");
  process.exit(1);
});

// Create HTTP server and Socket.IO server
const httpServer = createServer(app);
const io = new Server<
  ClientToServerEvents,
  Record<string, never>,
  Record<string, never>,
  SocketData
>(httpServer);
const socketLogger = createLogger("socket");
const appLogger = createLogger("app");

io.use(socketAuthenticate);

// Handle Socket.IO connections — every socket that reaches here has already been authenticated by
// socketAuthenticate above, so socket.data is populated. Each account gets one room (see socket.service.ts's
// emitToUser), and admins who can read sos also join the safety desk, joined here rather than in the middleware
// so auth and room-membership stay separate concerns.
io.on("connection", async (socket) => {
  const { userId, userType, role } = socket.data;
  try {
    await joinSocketRooms(socket);
  } catch (err) {
    socketLogger.error({ err, userId }, "Failed to join socket rooms");
    socket.disconnect(true);
    return;
  }
  registerSupportSocket(socket);
  socketLogger.info({ socketId: socket.id, userId, userType, role }, "Socket connected");

  socket.on("disconnect", (reason) => {
    socketLogger.info({ socketId: socket.id, userId, reason }, "Socket disconnected");
  });
});

initSocketService(io);

// Start the push receipt sweep (non-blocking).
startPushReceiptSweep();

// Release driver earnings and tips whose hold has ended (non-blocking).
startEarningsReleaseSweep();

const PORT = Number(process.env.PORT) || 3000;

httpServer.listen(PORT, () => {
  appLogger.info(`Server listening on port http://localhost:${PORT}`);
});
