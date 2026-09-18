import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { KnexHealthIndicator } from '../database/knex.health.js';
import { RedisHealthIndicator } from '../queues/redis.health.js';

// Version-neutral: these exist for Docker/CI/orchestrators, not API
// consumers, so they sit outside the /v1 surface entirely.
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly knexHealthIndicator: KnexHealthIndicator,
    private readonly redisHealthIndicator: RedisHealthIndicator,
  ) {}

  // Is the process up and able to respond at all? No dependency checks —
  // that's what /ready is for. A load balancer uses this to decide whether
  // to restart the container; it shouldn't restart a healthy process just
  // because the database had a blip.
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  // Can this instance actually serve traffic right now? Checks every
  // dependency a request would need.
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.knexHealthIndicator.check(),
      () => this.redisHealthIndicator.check(),
    ]);
  }


}
