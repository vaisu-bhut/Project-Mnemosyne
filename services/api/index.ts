import "dotenv/config";
import { getConfig } from "../config/index.js";
import { createServer } from "./server.js";

const config = getConfig();
const { app, deps, shutdown } = createServer(config);

// Make sure the artifact directory exists before we start serving.
await deps.store.init();

try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
} catch (err) {
  app.log.error(err);
  await shutdown();
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown().finally(() => process.exit(0));
  });
}
