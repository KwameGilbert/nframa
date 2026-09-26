import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { defineConfig } from "vitest/config";

// Tests run against a real database: the one in .env.test if it exists, otherwise the dev database in
// .env.development. They never clear data — see "Tests" in CLAUDE.md.
const envFile = [".env.test", ".env.development"].find((file) => existsSync(file));

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    env: {
      ...(envFile ? parse(readFileSync(envFile)) : {}),
      NODE_ENV: "test",
      LOG_LEVEL: process.env.LOG_LEVEL ?? "silent",
    },
    // Every request goes through the real database and bcrypt (CPU-bound, shared by concurrent tests), so
    // allow far more than the 5s default — the account-lockout test alone makes 11 password checks.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Tests in a file run concurrently (up to 5 at a time): most of their time is spent waiting on the
    // database, which may be remote. So every test sets up its own records and never relies on another test.
    sequence: { concurrent: true },
    // Vitest clears mock history before each test by default, which with concurrent tests would wipe codes
    // another test has just been sent. helpers/outbox.ts looks messages up by recipient, so keep them all.
    clearMocks: false,
  },
});
