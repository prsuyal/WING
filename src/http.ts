import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export function createHttpServer(route?: (request: IncomingMessage, response: ServerResponse) => Promise<boolean>) {
  return createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    if (route) {
      try { if (await route(request, response)) return; }
      catch { response.writeHead(500, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: "request unavailable" })); return; }
    }
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ service: "wing", status: "ok" }));
    } else {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
    }
  });
}
