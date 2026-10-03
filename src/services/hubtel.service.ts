import { createLogger } from "../config/logger.js";
import { AppError } from "../utils/AppError.js";

const logger = createLogger("app");

interface TokenizeCardInput {
  cardNumber: string;
  expiryMonth: number;
  expiryYear: number;
  cvv: string;
  cardholderName: string;
}

interface TokenizeMobileMoneyInput {
  phoneNumber: string;
  operator: string;
}

interface TokenizeBankAccountInput {
  accountNumber: string;
  accountName?: string;
  bankCode: string;
}

interface TransferInput {
  recipientToken: string;
  amount: number;
  currency: string;
  reference: string;
  description?: string;
}

interface HubtelTokenResponse {
  success: boolean;
  token?: string;
  error?: string;
  statusCode?: number;
}

interface HubtelTransferResponse {
  success: boolean;
  transactionId?: string;
  reference?: string;
  amount?: number;
  status?: string;
  error?: string;
  statusCode?: number;
}

class HubtelService {
  private apiKey: string;
  private apiUrl: string;

  constructor() {
    this.apiKey = process.env.HUBTEL_API_KEY || "";
    this.apiUrl = process.env.HUBTEL_API_URL || "https://api.hubtel.com";

    if (!this.apiKey) {
      logger.warn("HUBTEL_API_KEY not set; payment tokenization will fail");
    }
  }

  async tokenizeCard(input: TokenizeCardInput): Promise<string> {
    if (!this.apiKey) {
      throw AppError.badRequest("Payment provider not configured");
    }

    try {
      const response = await fetch(`${this.apiUrl}/v1/payment/tokenize/card`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cardNumber: input.cardNumber,
          expiryMonth: input.expiryMonth,
          expiryYear: input.expiryYear,
          cvv: input.cvv,
          cardholderName: input.cardholderName,
        }),
      });

      const data: HubtelTokenResponse = await response.json();

      if (!response.ok || !data.success) {
        logger.error(
          { statusCode: data.statusCode, error: data.error },
          "Hubtel card tokenization failed",
        );
        throw AppError.badRequest("Failed to tokenize card");
      }

      return data.token!;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ error }, "Hubtel card tokenization error");
      throw AppError.badRequest("Payment tokenization failed");
    }
  }

  async tokenizeMobileMoney(input: TokenizeMobileMoneyInput): Promise<string> {
    if (!this.apiKey) {
      throw AppError.badRequest("Payment provider not configured");
    }

    try {
      const response = await fetch(`${this.apiUrl}/v1/payment/tokenize/mobile-money`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          phoneNumber: input.phoneNumber,
          operator: input.operator,
        }),
      });

      const data: HubtelTokenResponse = await response.json();

      if (!response.ok || !data.success) {
        logger.error(
          { statusCode: data.statusCode, error: data.error },
          "Hubtel mobile money tokenization failed",
        );
        throw AppError.badRequest("Failed to tokenize mobile money account");
      }

      return data.token!;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ error }, "Hubtel mobile money tokenization error");
      throw AppError.badRequest("Mobile money tokenization failed");
    }
  }

  async tokenizeBankAccount(input: TokenizeBankAccountInput): Promise<string> {
    if (!this.apiKey) {
      throw AppError.badRequest("Payment provider not configured");
    }

    // Validate account first
    const isValid = await this.validateBankAccount(input.accountNumber, input.bankCode);
    if (!isValid) {
      throw AppError.badRequest("Invalid bank account details");
    }

    try {
      const response = await fetch(`${this.apiUrl}/v1/payment/tokenize/bank-account`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          accountNumber: input.accountNumber,
          accountName: input.accountName,
          bankCode: input.bankCode,
        }),
      });

      const data: HubtelTokenResponse = await response.json();

      if (!response.ok || !data.success) {
        logger.error(
          { statusCode: data.statusCode, error: data.error },
          "Hubtel bank account tokenization failed",
        );
        throw AppError.badRequest("Failed to tokenize bank account");
      }

      return data.token!;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ error }, "Hubtel bank account tokenization error");
      throw AppError.badRequest("Bank account tokenization failed");
    }
  }

  async validateBankAccount(accountNumber: string, bankCode: string): Promise<boolean> {
    if (!this.apiKey) {
      return false;
    }

    try {
      const response = await fetch(`${this.apiUrl}/v1/banks/verify-account`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          accountNumber,
          bankCode,
        }),
      });

      const data = await response.json();
      return data.success && response.ok;
    } catch (error) {
      logger.warn({ error }, "Bank account validation failed");
      return false;
    }
  }

  async verifyToken(token: string, otp?: string): Promise<boolean> {
    if (!this.apiKey) {
      return false;
    }

    try {
      const response = await fetch(`${this.apiUrl}/v1/payment/verify-token`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token, otp }),
      });

      const data = await response.json();
      return data.success && response.ok;
    } catch (error) {
      logger.error({ error }, "Hubtel token verification error");
      return false;
    }
  }

  async transferFunds(input: TransferInput): Promise<{ success: boolean; transactionId: string }> {
    if (!this.apiKey) {
      throw AppError.badRequest("Payment provider not configured");
    }

    try {
      const response = await fetch(`${this.apiUrl}/v1/payment/transfer`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recipientToken: input.recipientToken,
          amount: input.amount,
          currency: input.currency,
          reference: input.reference,
          description: input.description,
        }),
      });

      const data: HubtelTransferResponse = await response.json();

      if (!response.ok || !data.success) {
        logger.error(
          { statusCode: data.statusCode, error: data.error, reference: input.reference },
          "Hubtel transfer failed",
        );
        throw AppError.conflict("Transfer failed");
      }

      return {
        success: true,
        transactionId: data.transactionId || data.reference || "",
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ error, reference: input.reference }, "Hubtel transfer error");
      throw AppError.badRequest("Fund transfer failed");
    }
  }
}

export const hubtelService = new HubtelService();
