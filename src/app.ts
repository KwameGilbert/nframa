import express from "express";
import cors from "cors";
import helmet from "helmet";
import { captureResponseBody, httpLogger } from "./middlewares/httpLogger.js";
import { notFoundHandler } from "./middlewares/notFound.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { router } from "./routes/index.js";

// The Express app on its own, without a server: src/index.ts serves it, and tests call it in-process.
export const app = express();

// Behind a load balancer/reverse proxy, set TRUST_PROXY (e.g. 1 = one proxy hop) so req.ip is the real
// client IP. Without it every request looks like it comes from the proxy and shares one rate-limit bucket.
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy) {
  app.set("trust proxy", /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
}

app.use(captureResponseBody);
app.use(httpLogger);
app.use(helmet());
app.use(cors());
app.use(express.json());

// Only when STORAGE_DRIVER=local: serves files storage.service.ts wrote to disk, at the path in
// LOCAL_STORAGE_BASE_URL (e.g. base url ".../uploads" serves from LOCAL_STORAGE_DIR at "/uploads"). Files
// here are unauthenticated static content — fine for local/dev use, not for verification documents in
// production, where STORAGE_DRIVER should be "cloudinary" instead.
if ((process.env.STORAGE_DRIVER ?? "local") === "local" && process.env.LOCAL_STORAGE_BASE_URL) {
  const mountPath = new URL(process.env.LOCAL_STORAGE_BASE_URL).pathname;
  app.use(mountPath, express.static(process.env.LOCAL_STORAGE_DIR ?? "uploads"));
}

app.use(router);

app.use(notFoundHandler);
app.use(errorHandler);
