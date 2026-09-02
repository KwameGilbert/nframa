import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import type { Redis } from 'ioredis';
import { REDIS_CONNECTION, redisProvider } from './redis.provider.js';

// @Global(): Redis is core shared infrastructure, same reasoning as
// DatabaseModule. BullMQ manages its own internal connection (built from
// config below, not the shared client) — REDIS_CONNECTION here is a second,
// independent connection reserved for direct use (health pings now, caching
// or rate-limit storage later) so it's never contending with queue traffic.
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.getOrThrow<string>('redis.url'),
          // Required by BullMQ: its blocking commands can't tolerate ioredis
          // giving up and retrying a limited number of times.
          maxRetriesPerRequest: null,
        },
      }),
    }),
  ],
  providers: [redisProvider],
  exports: [REDIS_CONNECTION],
})
export class QueuesModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CONNECTION) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}
