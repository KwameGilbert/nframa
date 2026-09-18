import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { Knex } from 'knex';
import { KNEX_CONNECTION } from './knex.provider.js';

@Injectable()
export class KnexHealthIndicator {
  constructor(
    @Inject(KNEX_CONNECTION) private readonly knex: Knex,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  check() {
    return this.healthIndicatorService
      .check('database')
      .attempt(async () => {
        await this.knex.raw('select 1');
      })
      .withTimeout(2000);
  }
}
