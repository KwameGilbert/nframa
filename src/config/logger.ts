import pino from "pino";

const isDevelopment = process.env.NODE_ENV !== "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDevelopment ? "debug" : "info"),
  transport: isDevelopment
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      }
    : undefined,
});

export type LogType = "http" | "error" | "socket" | "process" | "app";

export function createLogger(type: LogType) {
  return logger.child({ type });
}
