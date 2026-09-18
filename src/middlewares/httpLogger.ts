import { randomUUID } from "node:crypto";
import { pinoHttp } from "pino-http";
import { createLogger } from "../config/logger.js";

export const httpLogger = pinoHttp({
  logger: createLogger("http"),
  genReqId: (req, res) => {
    const headerId = req.headers["x-request-id"];
    const id = typeof headerId === "string" ? headerId : randomUUID();
    res.setHeader("X-Request-Id", id);
    return id;
  },
});
