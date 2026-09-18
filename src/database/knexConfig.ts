import type { Knex } from "knex";
import { config as loadEnv } from "dotenv";

loadEnv({ path: `.env.${process.env.NODE_ENV ?? "development"}` });

const connection: Knex.PgConnectionConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: true } : undefined,
};

const base: Knex.Config = {
  client: "pg",
  connection,
  migrations: {
    directory: "./src/database/migrations",
  },
  seeds: {
    directory: "./src/database/seeds",
  },
};

const config: Record<string, Knex.Config> = {
  development: base,
  test: base,
  production: {
    ...base,
    pool: { min: 2, max: 10 },
  },
};

export default config;
