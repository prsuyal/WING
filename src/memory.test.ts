import assert from "node:assert/strict";
import { test } from "node:test";
import { Supermemory } from "supermemory";
import { createMemory, memoryNamespace, tripMemoryNamespace } from "./memory.ts";

function api(response: (path: string) => { status?: number; body: unknown }) {
  const calls: { path: string; body: Record<string, unknown>; method?: string }[] = [];
  const client = new Supermemory({
    apiKey: "unit-test-key", maxRetries: 0,
    fetch: async (input, init) => {
      const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer unit-test-key");
      calls.push({ path, body: JSON.parse(String(init?.body ?? "{}")), method: init?.method });
      const result = response(path);
      return new Response(JSON.stringify(result.body), { status: result.status ?? 200 });
    },
  });
  return { memory: createMemory(client), calls };
}

test("namespaces are stable, hide raw IDs, and separate users, projects and platforms", () => {
  const namespace = memoryNamespace("project-1", "imessage", "+15551234567");
  assert.match(namespace, /^wing_user_[a-f0-9]{64}$/);
  assert.doesNotMatch(namespace, /15551234567/);
  assert.equal(namespace, memoryNamespace("project-1", "imessage", "+15551234567"));
  assert.notEqual(namespace, memoryNamespace("project-2", "imessage", "+15551234567"));
  assert.notEqual(namespace, memoryNamespace("project-1", "telegram", "+15551234567"));
  assert.notEqual(namespace, memoryNamespace("project-1", "imessage", "+15557654321"));
  assert.notEqual(memoryNamespace("a:b", "c", "d"), memoryNamespace("a", "b:c", "d"));
  assert.throws(() => memoryNamespace("project", "imessage", " "), /Missing memory identity/);
});

test("trip namespaces satisfy the live API's length limit and isolate both owner and trip", () => {
  const owner = memoryNamespace("project", "imessage", "user");
  const trip = "00000000-0000-4000-8000-000000000001";
  const scope = tripMemoryNamespace(owner, trip);
  assert.ok(scope.length <= 100);
  assert.equal(scope, tripMemoryNamespace(owner, trip));
  assert.notEqual(scope, tripMemoryNamespace(owner, "00000000-0000-4000-8000-000000000002"));
  assert.notEqual(scope, tripMemoryNamespace(memoryNamespace("project", "imessage", "other"), trip));
  assert.throws(() => tripMemoryNamespace(owner, "invalid"));
});

test("the SDK calls v5 profile and hybrid search in exactly one namespace", async () => {
  const { memory, calls } = api((path) => ({ body: path.endsWith("profile")
    ? { profile: { static: [{ memory: "Home airport: RDU" }], dynamic: [{ memory: "Planning a trip home" }] } }
    : { results: [{ isLatest: true, memory: "Home airport: RDU" }, { isLatest: true, chunk: "Budget below $200" },
      { isLatest: false, memory: "Outdated budget $500" }] } }));
  const namespace = memoryNamespace("project", "imessage", "user");
  const context = await memory.recall(namespace, "where should I fly?");
  assert.deepEqual(calls.map((call) => call.path).sort(), [`/ns/${namespace}/profile`, `/ns/${namespace}/search`].sort());
  assert.ok(calls.every((call) => call.method === "POST"));
  assert.equal(calls.find((call) => call.path.endsWith("search"))?.body.query, "where should I fly?");
  assert.equal(calls.find((call) => call.path.endsWith("search"))?.body.searchMode, "hybrid");
  assert.equal(context, "Home airport: RDU\nPlanning a trip home\nBudget below $200");
  assert.doesNotMatch(context, /Outdated/);
});

test("successful exchanges use namespace-first document ingestion with the memory pipeline", async () => {
  const { memory, calls } = api(() => ({ body: { id: "server-document", status: "queued" } }));
  await memory.remember("wing_user_test", { id: "msg_123", text: "My home airport is RDU", reply: "got it" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.path, "/ns/wing_user_test/document");
  assert.equal(calls[0]?.body.id, "msg_123");
  assert.equal(calls[0]?.body.taskType, "memory");
  assert.equal(calls[0]?.body.dreaming, "instant");
  assert.deepEqual(JSON.parse(String(calls[0]?.body.content)), { user: "My home airport is RDU", wing: "got it" });
  assert.match(String(calls[0]?.body.date), /^\d{4}-\d{2}-\d{2}T/);
});

test("partial recall failures keep the available context; complete failures return empty context", async (t) => {
  t.mock.method(console, "error", () => {});
  for (const failed of ["profile", "search", "both"]) {
    const { memory, calls } = api((path) => {
      if (failed === "both" || path.endsWith(failed)) return { status: 503, body: { error: "private-content" } };
      return { body: path.endsWith("profile") ? { profile: { static: [{ memory: "RDU" }], dynamic: [] } }
        : { results: [{ isLatest: true, chunk: "RDU" }] } };
    });
    assert.equal(await memory.recall("wing_user_test", "home?"), failed === "both" ? "" : "RDU");
    assert.equal(calls.length, 2);
  }
});

test("authentication and rate-limit failures are not retried or returned as memory", async (t) => {
  t.mock.method(console, "error", () => {});
  for (const status of [401, 429]) {
    const { memory, calls } = api(() => ({ status, body: { error: "secret-key" } }));
    assert.equal(await memory.recall("wing_user_test", "home?"), "");
    await assert.rejects(memory.remember("wing_user_test", { id: "msg_1", text: "hi", reply: "hello" }));
    assert.equal(calls.length, 3);
  }
});

test("invalid namespaces never reach the API, and oversized context is bounded", async () => {
  const { memory, calls } = api((path) => ({ body: path.endsWith("profile")
    ? { profile: { static: [{ memory: "x".repeat(50_000) }], dynamic: [] } } : { results: [] } }));
  await assert.rejects(memory.recall("../another_user", "home?"), /Invalid memory namespace/);
  await assert.rejects(memory.remember("", { id: "id", text: "hi", reply: "hello" }), /Invalid memory namespace/);
  assert.equal(calls.length, 0);
  assert.equal((await memory.recall("wing_user_test", "home?")).length, 12_000);
});

test("stalled recall requests time out instead of holding the agent indefinitely", { timeout: 6000 }, async (t) => {
  t.mock.method(console, "error", () => {});
  let requests = 0;
  let aborted = 0;
  const client = new Supermemory({
    apiKey: "unit-test-key", maxRetries: 0,
    fetch: async (_input, init) => {
      requests++;
      return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => { aborted++; reject(new Error("aborted")); }, { once: true });
      });
    },
  });
  assert.equal(await createMemory(client).recall("wing_user_test", "home?"), "");
  assert.equal(requests, 2);
  assert.equal(aborted, 2);
});
