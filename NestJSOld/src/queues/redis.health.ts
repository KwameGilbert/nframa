import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { Redis } from 'ioredis';
import { REDIS_CONNECTION } from './redis.provider.js';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    @Inject(REDIS_CONNECTION) private readonly redis: Redis,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  check() {
    return this.healthIndicatorService
      .check('redis')
      .attempt(async () => {
        await this.redis.ping();
      })
      .withTimeout(2000);
  }
}
