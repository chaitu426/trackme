import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { env } from "@trackme/config";
import { registerCollectRoutes } from "./routes/collect.js";

const server = Fastify({
  logger: {
    level: env.NODE_ENV === "production" ? "info" : "debug",
  },
  bodyLimit: env.MAX_EVENT_PAYLOAD_BYTES,
});

async function main() {
  // Security headers
  await server.register(helmet, {
    contentSecurityPolicy: false,
  });

  // CORS: Allow tracker to post from any client origin
  await server.register(cors, {
    origin: true,
    methods: ["POST", "OPTIONS", "GET"],
  });

  // Global Rate Limiting
  await server.register(rateLimit, {
    max: env.INGESTION_RATE_LIMIT_MAX,
    timeWindow: env.INGESTION_RATE_LIMIT_WINDOW_MS,
  });

  // Health check endpoint
  server.get("/health", async () => ({ status: "ok", service: "ingestion-node" }));

  // Register collection routes
  await registerCollectRoutes(server);

  // Start server
  const port = env.INGESTION_PORT;
  try {
    await server.listen({ port, host: "0.0.0.0" });
    server.log.info(`🚀 Ingestion edge service running on port ${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

main();

