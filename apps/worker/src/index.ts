import { createServer } from "node:http";
import { z } from "zod";

const environmentSchema = z.object({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4001)
});

const environment = environmentSchema.parse(process.env);
const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      status: "ok",
      service: "worker",
      jobs: "not_configured"
    }));
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not_found" }));
});

server.listen(environment.PORT, environment.HOST);
server.on("error", (error) => {
  console.error("Worker health server failed to start", error);
  process.exitCode = 1;
});
