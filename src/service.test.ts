import assert from "node:assert/strict";
import { test } from "node:test";
import type { Database } from "./database.ts";
import { createService } from "./service.ts";
import { createHandler } from "./handler.ts";
import type { Memory } from "./memory.ts";

const owner = "00000000-0000-4000-8000-000000000001";
const inbound = "00000000-0000-4000-8000-000000000002";
const outbound = "00000000-0000-4000-8000-000000000003";
function fixture() {
  const received = new Set<string>();
  const events: string[] = [];
  const database: Database = {
    receive: async (identity, spaceId, providerId) => {
      const key = `${identity}:${spaceId}:${providerId}`;
      const isNew = !received.has(key); received.add(key); events.push("receive");
      return { userId: owner, messageId: inbound, isNew };
    },
    prepareReply: async () => { events.push("prepare"); return outbound; },
    status: async (_owner, _message, status) => { events.push(status); },
    saveImage: async () => { events.push("upload"); return `${owner}/${inbound}`; },
  };
  const chat = { id: "dm", type: "dm" as const, send: async (_text: string) => { events.push("send"); }, responding: async <T>(fn: () => T | Promise<T>) => fn() };
  const message = { id: "message", direction: "inbound" as const, sender: { id: "user", __platform: "imessage" }, content: { type: "text" as const, text: "hello" } };
  return { database, chat, message, events };
}

test("recreated service suppresses provider replay using persistent deduplication", async () => {
  const { database, chat, message, events } = fixture();
  let calls = 0;
  const handler: Parameters<typeof createService>[2] = async (space) => { calls++; await space.send("hello"); };
  await createService(database, "project", handler)(chat, message);
  await createService(database, "project", handler)(chat, message);
  assert.equal(calls, 1);
  assert.deepEqual(events, ["receive", "prepare", "send", "sent", "handled", "receive"]);
});

test("database failures prevent external replies", async () => {
  const { database, chat, message, events } = fixture();
  database.prepareReply = async () => { throw new Error("database unavailable"); };
  await assert.rejects(createService(database, "project", async (space) => { await space.send("hello"); })(chat, message));
  assert.ok(!events.includes("send"));
  assert.ok(events.includes("failed"));
});

test("an uncertain provider send is recorded and never retried on replay", async () => {
  const { database, chat, message, events } = fixture();
  let sends = 0;
  chat.send = async () => { sends++; throw new Error("provider timeout"); };
  const service = createService(database, "project", async (space) => { await space.send("hello"); });
  await assert.rejects(service(chat, message));
  await service(chat, message);
  assert.equal(sends, 1);
  assert.ok(events.includes("delivery_unknown"));
});

test("image bytes are privately saved before acknowledging access", async () => {
  const { database, chat, message, events } = fixture();
  const memory: Memory = { recall: async () => "", remember: async () => {} };
  const handle = createHandler(async () => { assert.fail("No image model yet"); }, memory, "project");
  const content = { type: "attachment" as const, id: "image", name: "image.png", mimeType: "image/png", size: 3,
    read: async () => Buffer.from("png"), stream: async () => new ReadableStream() };
  await createService(database, "project", handle)(chat, { ...message, content });
  assert.ok(events.indexOf("upload") < events.indexOf("send"));
  assert.ok(events.includes("handled"));
});

test("group, outbound and anonymous messages never create owner records", async () => {
  const { database, chat, message, events } = fixture();
  const service = createService(database, "project", async () => { assert.fail("Ignored message"); });
  await service({ ...chat, type: "group" }, message);
  await service(chat, { ...message, direction: "outbound" });
  await service(chat, { ...message, sender: undefined });
  assert.deepEqual(events, []);
});

test("each outgoing effect gets its own stable sequence for acknowledgments and probes", async () => {
  const { database, chat, message } = fixture();
  const indices: number[] = [];
  database.prepareReply = async (_received, _space, _text, index) => { indices.push(index); return outbound; };
  await createService(database, "project", async (space) => { await space.send("ack"); await space.send("probe"); })(chat, message);
  assert.deepEqual(indices, [0, 1]);
});
