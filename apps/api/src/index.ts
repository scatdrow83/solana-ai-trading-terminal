import Fastify from "fastify";
import { z } from "zod";

const environmentSchema = z.object({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development")
});

const environment = environmentSchema.parse(process.env);
const app = Fastify({
  logger: {
    level: environment.NODE_ENV === "production" ? "info" : "debug",
    redact: ["req.headers.authorization", "req.headers.cookie"]
  }
});

app.get("/health", async () => ({
  status: "ok",
  service: "api",
  integrations: {
    database: "not_configured",
    trading: "disabled"
  }
}));

try {
  await app.listen({ host: environment.HOST, port: environment.PORT });
} catch (error) {
  app.log.error(error, "API failed to start");
  process.exitCode = 1;
}
