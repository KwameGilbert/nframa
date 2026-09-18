import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

export const REDIS_CONNECTION = Symbol('REDIS_CONNECTION');

export const redisProvider: Provider = {
  provide: REDIS_CONNECTION,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Redis =>
    // maxRetriesPerRequest: null is required by BullMQ for any connection it
    // uses (blocking commands break otherwise) — this same client also backs
    // the readiness ping, so the requirement is set once, here.
    new Redis(config.getOrThrow<string>('redis.url'), { maxRetriesPerRequest: null }),
};
