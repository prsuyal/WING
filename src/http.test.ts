import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { createHttpServer } from "./http.ts";

test("health endpoint exposes no private records and unsupported routes stay closed", async (t) => {
  const server = createHttpServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { service: "wing", status: "ok" });
  assert.equal(health.headers.get("cache-control"), "no-store");
  assert.equal((await fetch(`${base}/users`)).status, 404);
  assert.equal((await fetch(`${base}/health`, { method: "POST" })).status, 404);
});
