import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { shareTokenPattern, type SharingStore } from "./sharing.ts";

export function createHttpServer(route?: (request: IncomingMessage, response: ServerResponse) => Promise<boolean>, sharing?: Pick<SharingStore, "summary">) {
  return createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    if (route) {
      try { if (await route(request, response)) return; }
      catch { response.writeHead(500, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: "request unavailable" })); return; }
    }
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ service: "wing", status: "ok" }));
    } else if (
      request.method === "GET" &&
      request.url?.startsWith("/public/trips/")
    ) {
      const token = request.url.slice("/public/trips/".length);
      if (!shareTokenPattern.test(token)) {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Link unavailable" }));
        return;
      }
      try {
        if (!sharing) throw new Error("Sharing not configured");
        const summary = await sharing.summary(token);
        response.writeHead(summary ? 200 : 404, {
          "Content-Type": "application/json",
        });
        response.end(JSON.stringify(summary ?? { error: "Link unavailable" }));
      } catch {
        response.writeHead(503, {
          "Content-Type": "application/json",
          "Retry-After": "15",
        });
        response.end(JSON.stringify({ error: "Trip temporarily unavailable" }));
      }
    } else {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
    }
  });
}
