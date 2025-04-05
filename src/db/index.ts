import { drizzle } from "drizzle-orm/node-postgres";
import pkg from "pg";
import "dotenv/config";
import { hypothesesTable, fileMetadataTable } from "./schemas";

const { Pool } = pkg;
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
});

export const db = drizzle(pool, {
  schema: {
    hypotheses: hypothesesTable,
    fileMetadata: fileMetadataTable,
  },
});

export * from "./schemas";
