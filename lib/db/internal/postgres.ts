import {Pool} from 'pg';
import {drizzle} from 'drizzle-orm/node-postgres';
import 'dotenv/config';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
});

export const pgDb = drizzle({client: pool});
export type PGDB = typeof pgDb;
