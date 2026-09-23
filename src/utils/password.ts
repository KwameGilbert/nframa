import { compare, hash } from "bcryptjs";

// ~250ms per hash; the salt is embedded in the hash string, so users.passwordSalt goes unused.
const BCRYPT_ROUNDS = 12;

export function hashPassword(password: string): Promise<string> {
  return hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return compare(password, passwordHash);
}
