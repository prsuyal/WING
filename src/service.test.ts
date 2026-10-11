import assert from "node:assert/strict";
import { test } from "node:test";
import type { Database } from "./database.ts";
import { createService } from "./service.ts";
import { createHandler } from "./handler.ts";
import type { Memory } from "./memory.ts";
import { createBookings } from "./booking.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FlightPlanner } from "./flight-store.ts";
import type { ProfileStore } from "./profile.ts";

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

test("an uncertain schedule-preview send never triggers a second fallback reply", async () => {
  const { database, chat, message, events } = fixture();
  let sends = 0;
  chat.send = async () => { sends++; throw new Error("provider timeout after accepting text"); };
  const handler = createHandler(async () => "unused", { recall: async () => "", remember: async () => {} }, "project", async () => "schedule preview");
  const content = { type: "attachment" as const, id: "image", name: "schedule.png", mimeType: "image/png", size: 3, read: async () => Buffer.from("png"), stream: async () => new ReadableStream() };
  await assert.rejects(createService(database, "project", handler)(chat, { ...message, content }));
  assert.equal(sends, 1);
  assert.ok(events.includes("delivery_unknown"));
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

test("a split review is recorded once and sent only after all bubbles are accepted", async () => {
  const { database, chat, message, events } = fixture();
  const review = "Save this for $300?\n\nEWR → SFO\n\nSimulated booking, no real ticket or charge\nreply yes";
  const sent: string[] = [];
  database.prepareReply = async (_owner, _space, text) => { assert.equal(text, review); events.push("prepare"); return outbound; };
  chat.send = async (text) => { assert.ok(!events.includes("sent")); sent.push(text); events.push("send"); };
  await createService(database, "project", async (space) => { await space.send(review); })(chat, message);
  assert.equal(sent.length, 3);
  assert.deepEqual(events, ["receive", "prepare", "send", "send", "send", "sent", "handled"]);
});

test("a partial multi-bubble review stays unconfirmed and does not send its remaining bubbles", async () => {
  const { database, chat, message, events } = fixture();
  let sends = 0;
  chat.send = async () => { if (++sends === 2) throw new Error("delivery uncertain"); };
  const service = createService(database, "project", async (space) => { await space.send("price\n\nterms\n\nreply yes"); });
  await assert.rejects(service(chat, message)); await service(chat, message);
  assert.equal(sends, 2); assert.ok(events.includes("delivery_unknown")); assert.ok(!events.includes("sent"));
});

test("a yes arriving between review bubbles cannot become approval after delivery finishes", async () => {
  const { database, chat, message } = fixture();
  let began!: () => void, finish!: () => void;
  const started = new Promise<void>((resolve) => { began = resolve; });
  const held = new Promise<void>((resolve) => { finish = resolve; });
  chat.send = async () => { began(); await held; };
  const bookings = createBookings({} as SupabaseClient, {} as ProfileStore, {} as FlightPlanner);
  let blocked = false;
  const service = createService(database, "project", async (space, incoming, actor) => {
    if (incoming.id === message.id) await space.send("terms\n\nreply yes");
    else {
      assert.equal(actor.replyInFlight, true);
      await assert.rejects(bookings.approve({ ...actor, interpret: async () => true }, "00000000-0000-4000-8000-000000000001"), /separate yes/);
      blocked = true;
    }
  });
  const first = service(chat, message); await started;
  await service(chat, { ...message, id: "early", content: { type: "text", text: "yes book" } });
  assert.equal(blocked, true);
  finish(); await first;
});
