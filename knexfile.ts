import type { Knex } from 'knex';
import { databaseConfig } from './src/config/configuration.js';

// Same validated config the app uses (src/config/configuration.ts) — the CLI
// and the running app can never disagree about which database they're
// pointed at.
const database = databaseConfig();

const config: Knex.Config = {
  client: 'pg',
  connection: database.url,
  pool: database.pool,
  migrations: {
    directory: './database/migrations',
    extension: 'ts',
  },
  seeds: {
    directory: './database/seeds',
    extension: 'ts',
  },
};

export default config;
