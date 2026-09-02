import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';
import { KnexHealthIndicator } from '../database/knex.health.js';
import { RedisHealthIndicator } from '../queues/redis.health.js';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [KnexHealthIndicator, RedisHealthIndicator],
})
export class HealthModule {}
