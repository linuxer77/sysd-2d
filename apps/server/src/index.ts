import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { createServer } from "./server.js";

const here = dirname(fileURLToPath(import.meta.url));
const server = createServer({ dbPath: process.env.DB_PATH ?? "siege.sqlite", staticDir: process.env.STATIC_DIR ?? join(here, "../../web/dist") });
const port = await server.listen(Number(process.env.PORT ?? 8787), process.env.HOST ?? "0.0.0.0");
console.log(`sysd-2d server listening on port ${port}`);
const shutdown = (): void => { void server.close().then(() => process.exit(0)); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
