import { createLogger } from "../config/logger.js";
import { AppError } from "../utils/AppError.js";
import { hubtelService } from "./hubtel.service.js";
import * as paystackService from "./paystack.service.js";

const logger = createLogger("app");

type PaymentProvider = "hubtel" | "paystack";

type PaymentMethodDetails = Record<string, unknown>;

interface TransferInput {
  recipientToken: string;
  amount: number;
  currency: string;
  reference: string;
  description?: string;
}

class PaymentService {
  private primaryProvider: PaymentProvider;
  private fallbackProvider: PaymentProvider;

  constructor() {
    const env = (process.env.PAYMENT_PROVIDER || "paystack").toLowerCase() as PaymentProvider;
    this.primaryProvider = ["hubtel", "paystack"].includes(env) ? env : "paystack";
    this.fallbackProvider = this.primaryProvider === "paystack" ? "hubtel" : "paystack";

    logger.info(`Payment service initialized: primary=${this.primaryProvider}, fallback=${this.fallbackProvider}`);
  }

  /**
   * Tokenize a payment method via the configured provider.
   * Attempts fallback if primary fails.
   */
  async tokenize(
    type: "card" | "mobile_money" | "bank_account",
    details: PaymentMethodDetails,
  ): Promise<{ token: string; provider: PaymentProvider }> {
    let lastError: Error | null = null;

    for (const provider of [this.primaryProvider, this.fallbackProvider]) {
      try {
        const token = await this.tokenizeWithProvider(provider, type, details);
        return { token, provider };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn({ error }, `Tokenization failed with ${provider}, trying next provider`);
      }
    }

    logger.error({ lastError }, "Tokenization failed with all providers");
    throw lastError || AppError.badRequest("Payment tokenization failed");
  }

  /**
   * Verify that a tokenized payment method is valid.
   */
  async verifyToken(provider: PaymentProvider, token: string): Promise<boolean> {
    try {
      if (provider === "hubtel") {
        return await hubtelService.verifyToken(token);
      } else {
        return await paystackService.verifyToken(token);
      }
    } catch (error) {
      logger.error({ error }, `Token verification failed for ${provider}`);
      return false;
    }
  }

  /**
   * Transfer funds to a verified payment method.
   * Attempts fallback if primary fails.
   */
  async transfer(
    provider: PaymentProvider,
    input: TransferInput,
  ): Promise<{ success: boolean; transactionId: string }> {
    let lastError: Error | null = null;
    const providers = provider === this.primaryProvider
      ? [this.primaryProvider, this.fallbackProvider]
      : [provider];

    for (const prov of providers) {
      try {
        return await this.transferWithProvider(prov, input);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn({ error }, `Transfer failed with ${prov}, trying next provider`);
      }
    }

    logger.error({ lastError, reference: input.reference }, "Transfer failed with all providers");
    throw lastError || AppError.conflict("Fund transfer failed");
  }

  // Private helpers

  private async tokenizeWithProvider(
    provider: PaymentProvider,
    type: "card" | "mobile_money" | "bank_account",
    details: PaymentMethodDetails,
  ): Promise<string> {
    if (provider === "hubtel") {
      if (type === "card") {
        return await hubtelService.tokenizeCard({
          cardNumber: String(details.cardNumber),
          expiryMonth: Number(details.expiryMonth),
          expiryYear: Number(details.expiryYear),
          cvv: String(details.cvv),
          cardholderName: String(details.cardholderName),
        });
      } else if (type === "mobile_money") {
        return await hubtelService.tokenizeMobileMoney({
          phoneNumber: String(details.phoneNumber),
          operator: String(details.operator),
        });
      } else if (type === "bank_account") {
        return await hubtelService.tokenizeBankAccount({
          accountNumber: String(details.accountNumber),
          accountName: details.accountName ? String(details.accountName) : undefined,
          bankCode: String(details.bankCode),
        });
      }
    } else {
      if (type === "card") {
        return await paystackService.tokenizeCard({
          cardNumber: String(details.cardNumber),
          expiryMonth: Number(details.expiryMonth),
          expiryYear: Number(details.expiryYear),
          cvv: String(details.cvv),
          cardholderName: String(details.cardholderName),
        });
      } else if (type === "mobile_money") {
        return await paystackService.tokenizeMobileMoney(
          String(details.phoneNumber),
          String(details.operator),
        );
      }
      // Paystack doesn't support bank account tokenization, fall back to primary
    }

    throw AppError.badRequest(`Tokenization not supported for ${type} with ${provider}`);
  }

  private async transferWithProvider(
    provider: PaymentProvider,
    input: TransferInput,
  ): Promise<{ success: boolean; transactionId: string }> {
    if (provider === "hubtel") {
      return await hubtelService.transferFunds(input);
    } else {
      return await paystackService.transferFunds(input);
    }
  }
}

export const paymentService = new PaymentService();
