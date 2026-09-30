import express from "express";
import cors from "cors";
import helmet from "helmet";
import { captureResponseBody, httpLogger } from "./middlewares/httpLogger.js";
import { notFoundHandler } from "./middlewares/notFound.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { router } from "./routes/index.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- required by Express's ambient augmentation pattern
  namespace Express {
    interface Request {
      // The JSON body exactly as received, for checking webhook signatures (see verifyPaystackSignature).
      rawBody?: Buffer;
    }
  }
}

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
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request).rawBody = buf;
    },
  }),
);

app.use(router);

app.use(notFoundHandler);
app.use(errorHandler);
