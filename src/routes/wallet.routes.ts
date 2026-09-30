import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import { verifyPaystackSignature } from "../middlewares/paystackSignature.js";
import { walletPaymentLimit } from "../middlewares/rateLimit.js";
import {
  listTransactionsQuerySchema,
  paystackEventSchema,
  topUpReferenceParamsSchema,
  topUpSchema,
} from "../schemas/wallet.schema.js";
import {
  getWallet,
  handlePaystackWebhook,
  listTransactions,
  startTopUp,
  verifyTopUp,
} from "../controllers/wallet.controller.js";

export const walletRouter = Router();

// authenticate only: every wallet route acts on the caller's own wallet, taken from the access token.
walletRouter.get("/wallet", authenticate, getWallet);

walletRouter.get(
  "/wallet/transactions",
  authenticate,
  validate({ query: listTransactionsQuerySchema }),
  listTransactions,
);

walletRouter.post(
  "/wallet/topup",
  authenticate,
  walletPaymentLimit,
  validate({ body: topUpSchema }),
  startTopUp,
);

walletRouter.post(
  "/wallet/topup/:reference/verify",
  authenticate,
  walletPaymentLimit,
  validate({ params: topUpReferenceParamsSchema }),
  verifyTopUp,
);

// Called by Paystack, so no access token: the signature over the raw body is what proves it's them.
walletRouter.post(
  "/webhooks/paystack",
  verifyPaystackSignature,
  validate({ body: paystackEventSchema }),
  handlePaystackWebhook,
);
