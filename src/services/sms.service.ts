import { arkeselProvider } from "./arkesel.service.js";
import { smsOnlineGhProvider } from "./smsOnlineGh.service.js";

export interface SmsBalance {
  smsUnits: number;
  mainBalance: string;
}

// Each SMS provider (one file per provider, like arkesel.service.ts) implements this; callers only use sendSms/getSmsBalance.
export interface SmsProvider {
  send(to: string, message: string): Promise<void>;
  getBalance(): Promise<SmsBalance>;
}

const providers: Record<string, SmsProvider> = {
  arkesel: arkeselProvider,
  smsonlinegh: smsOnlineGhProvider,
};

// SMS_PROVIDER picks the provider (default arkesel), read per call so a changed env applies without code changes.
function provider(): SmsProvider {
  const name = (process.env.SMS_PROVIDER || "arkesel").toLowerCase();
  const selected = providers[name];
  if (!selected) {
    throw new Error(`Unknown SMS_PROVIDER "${name}"`);
  }
  return selected;
}

export async function sendSms(to: string, message: string): Promise<void> {
  await provider().send(to, message);
}

// What's left on the provider account. Sign-in codes come out of the same units as broadcasts.
export async function getSmsBalance(): Promise<SmsBalance> {
  return provider().getBalance();
}
