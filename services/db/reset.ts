import "dotenv/config";
import { getConfig } from "../config/index.js";
import { resetSchema } from "./schema.js";

// CLI: drop and recreate the schema for the configured DATABASE_URL.
const config = getConfig();
await resetSchema(config.DATABASE_URL, config.VECTOR_DIM);
console.log(`Schema reset on ${new URL(config.DATABASE_URL).pathname.slice(1)} (vector dim ${config.VECTOR_DIM}).`);
