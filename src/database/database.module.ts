import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Knex } from 'knex';
import { KNEX_CONNECTION, knexProvider } from './knex.provider.js';

// @Global(): every domain module needs database access, and there's exactly
// one pool for the whole process — re-importing this per-module would be
// pure boilerplate, not real encapsulation.
@Global()
@Module({
  providers: [knexProvider],
  exports: [KNEX_CONNECTION],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(KNEX_CONNECTION) private readonly knex: Knex) {}

  async onApplicationShutdown(): Promise<void> {
    await this.knex.destroy();
  }
}
