import { randomBytes } from "node:crypto";

// No 0/O or 1/I, so a code read aloud or typed from a screen can't be misread.
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// A short human-friendly code like "DR-7KQ2MX". Not guaranteed unique: callers rely on a unique column.
export function generateCode(prefix: string): string {
  let code = "";
  for (const byte of randomBytes(6)) {
    code += CODE_CHARS[byte % CODE_CHARS.length];
  }
  return `${prefix}-${code}`;
}
