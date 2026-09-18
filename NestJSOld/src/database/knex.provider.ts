import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import knexFactory, { type Knex } from 'knex';

export const KNEX_CONNECTION = Symbol('KNEX_CONNECTION');

export const knexProvider: Provider = {
  provide: KNEX_CONNECTION,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Knex =>
    knexFactory({
      client: 'pg',
      connection: config.getOrThrow<string>('database.url'),
      pool: {
        min: config.getOrThrow<number>('database.pool.min'),
        max: config.getOrThrow<number>('database.pool.max'),
      },
    }),
};
