import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { createHttpServer } from "./http.ts";

test("summary endpoint is read-only, private, and fails closed", async (t) => {
  const token = "a".repeat(43);
  const summary = {
    displayName: "Aarnav",
    status: "planning" as const,
    departureAirport: "RDU",
    arrivalAirport: null,
    outboundDate: null,
    returnDate: null,
    updatedAt: "2026-10-10T00:00:00Z",
    simulated: true as const,
  };
  const server = createHttpServer(undefined, {
    summary: async (value) => {
      if (value === "b".repeat(43)) return null;
      if (value === "c".repeat(43)) throw new Error("private database failure");
      return summary;
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/public/trips/`;
  const response = await fetch(`${base}${token}`);
  assert.deepEqual(await response.json(), summary);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("x-robots-tag")!, /noindex/);
  assert.equal(
    (await fetch(`${base}${token}`, { method: "POST" })).status,
    404,
  );
  assert.equal((await fetch(`${base}123456`)).status, 404);
  assert.equal((await fetch(`${base}${"b".repeat(43)}`)).status, 404);
  const failure = await fetch(`${base}${"c".repeat(43)}`);
  assert.equal(failure.status, 503);
  assert.equal((await failure.text()).includes("database"), false);
});

test("health endpoint exposes no private records and unsupported routes stay closed", async (t) => {
  const server = createHttpServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  );
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
