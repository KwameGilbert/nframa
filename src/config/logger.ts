import pino from "pino";

const isDevelopment = process.env.NODE_ENV !== "production";
const level = process.env.LOG_LEVEL ?? (isDevelopment ? "debug" : "info");

const targets: pino.TransportTargetOptions[] = [
  {
    target: isDevelopment ? "pino-pretty" : "pino/file",
    level,
    options: isDevelopment
      ? {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname,req,res,responseTime,requestBody,responseBody,type",
        }
      : { destination: 1 },
  },
  {
    target: "pino-roll",
    level,
    options: {
      file: "logs/app/app.log",
      frequency: "daily",
      dateFormat: "yyyy-MM-dd",
      size: "10m",
      mkdir: true,
    },
  },
  {
    target: "pino-roll",
    level: "error",
    options: {
      file: "logs/error/error.log",
      frequency: "daily",
      dateFormat: "yyyy-MM-dd",
      size: "10m",
      mkdir: true,
    },
  },
];

export const logger = pino(
  { level, timestamp: pino.stdTimeFunctions.isoTime },
  pino.transport({ targets }),
);

export type LogType = "http" | "error" | "socket" | "process" | "app";

export function createLogger(type: LogType) {
  return logger.child({ type });
}
