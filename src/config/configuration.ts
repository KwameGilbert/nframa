import { registerAs } from '@nestjs/config';
import { validateEnv } from './env.validation.js';

// Validated once, at import time — every consumer (Nest's ConfigModule below,
// knexfile.ts, scripts/generate-openapi.ts) shares this single source of
// truth instead of re-reading and re-validating raw process.env separately.
const env = validateEnv(process.env);

export const appConfig = registerAs('app', () => ({
  env: env.NODE_ENV,
  port: env.PORT,
  corsOrigins: env.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
}));

export const databaseConfig = registerAs('database', () => ({
  url: env.DATABASE_URL,
  pool: { min: env.DATABASE_POOL_MIN, max: env.DATABASE_POOL_MAX },
}));

export const redisConfig = registerAs('redis', () => ({
  url: env.REDIS_URL,
}));

export const swaggerConfig = registerAs('swagger', () => ({
  enabled: env.SWAGGER_ENABLED,
}));

export const throttleConfig = registerAs('throttle', () => ({
  ttlMs: env.THROTTLE_TTL_MS,
  limit: env.THROTTLE_LIMIT,
}));

export const logConfig = registerAs('log', () => ({
  level: env.LOG_LEVEL,
}));

export const allConfig = [
  appConfig,
  databaseConfig,
  redisConfig,
  swaggerConfig,
  throttleConfig,
  logConfig,
];
