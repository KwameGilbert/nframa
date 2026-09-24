import knex from "knex";
import pg from "pg";
import knexConfig from "./knexConfig.js";

// Return DATE columns (e.g. users.dateOfBirth) as their "YYYY-MM-DD" string. By default pg turns them into a
// JS Date at local midnight, which serializes with a time component and can shift the day across timezones.
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);

const environment = process.env.NODE_ENV ?? "development";

const db = knex(knexConfig[environment]);

export default db;
