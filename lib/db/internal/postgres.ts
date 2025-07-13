import {Pool} from 'pg';
import {drizzle} from 'drizzle-orm/node-postgres';
import * as dotenv from 'dotenv';
dotenv.config({override: true});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
});

export function getPgDrizzle(customSchema: Record<string, any>) {
  return drizzle(pool, {schema: customSchema});
}
export {pool as pgPool};

export async function closePgPool() {
  await pool.end();
}
