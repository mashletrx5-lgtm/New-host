import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Without this handler an idle client that loses its connection (e.g. Neon
// terminates idle connections with error code 57P01) emits an "error" event
// on the pool with no listener → Node.js treats it as an uncaught exception
// and crashes the process. pg-pool automatically removes the broken client
// and replaces it on the next query; we just need to absorb the event.
pool.on("error", (err) => {
  console.error("[db pool] Idle client error — connection will be re-established on next query:", err.message);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
