import { config } from "dotenv";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { createLogger } from "./config/logger.js";
import { app } from "./app.js";

config({ path: `.env.${process.env.NODE_ENV ?? "development"}` });

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
const io = new Server(httpServer);
const socketLogger = createLogger("socket");
const appLogger = createLogger("app");

// Handle Socket.IO connections
io.on("connection", (socket) => {
  socketLogger.info({ socketId: socket.id }, "Socket connected");

  socket.on("disconnect", () => {
    socketLogger.info({ socketId: socket.id }, "Socket disconnected");
  });
});

const PORT = Number(process.env.PORT) || 3000;

httpServer.listen(PORT, () => {
  appLogger.info(`Server listening on port http://localhost:${PORT}`);
});
