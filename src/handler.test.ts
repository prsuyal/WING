import assert from "node:assert/strict";
import { test } from "node:test";
import { createHandler } from "./handler.ts";
import type { ModelMessage } from "ai";
import { memoryNamespace, type Memory } from "./memory.ts";

const emptyMemory: Memory = { recall: async () => "", remember: async () => {} };

function chat(id: string, type: "dm" | "group" = "dm") {
  const replies: unknown[] = [];
  return { id, type, replies,
    send: async (content: unknown) => { replies.push(content); return undefined; },
    responding: async <T>(fn: () => T | Promise<T>) => fn(),
  };
}
function message(id: string, text: string) {
  return { id, direction: "inbound" as const, content: { type: "text" as const, text },
    sender: { id: "sender-1", __platform: "imessage" },
  };
}

test("DM replies use recent history and suppress duplicate events", async () => {
  const calls: ModelMessage[][] = [];
  const handle = createHandler(async (messages) => { calls.push(messages); return "hello"; }, emptyMemory, "test-project");
  const dm = chat("dm");
  await handle(dm, message("1", "hi"));
  await handle(dm, message("1", "hi"));
  await handle(dm, message("2", "where can we go?"));
  assert.equal(dm.replies.length, 2);
  assert.equal(calls[1]?.length, 3);
});

test("group messages never reach Claude or personal memory", async () => {
  const calls: ModelMessage[][] = [];
  let recalls = 0;
  const handle = createHandler(async (messages) => { calls.push(messages); return "hello"; },
    { ...emptyMemory, recall: async () => { recalls++; return ""; } }, "test-project");
  await handle(chat("private"), message("1", "private budget"));
  const group = chat("group", "group");
  await handle(group, message("2", "anyone hungry?"));
  assert.equal(group.replies.length, 0);
  await handle(group, message("3", "wing help us plan"));
  assert.equal(group.replies.length, 0);
  assert.equal(calls.length, 1);
  assert.equal(recalls, 1);
});

test("outbound and anonymous messages do not reach Claude", async () => {
  const handle = createHandler(async () => { assert.fail("Should not call model"); }, emptyMemory, "test-project");
  const dm = chat("dm");
  await handle(dm, { ...message("1", "hi"), direction: "outbound" });
  await handle(dm, { ...message("2", "hi"), sender: undefined });
  assert.equal(dm.replies.length, 0);
});

test("model failure produces a retry message and next message still works", async () => {
  let calls = 0;
  const handle = createHandler(async () => { if (++calls === 1) throw new Error("offline"); return "hello"; }, emptyMemory, "test-project");
  const dm = chat("dm");
  await handle(dm, message("1", "hi"));
  await handle(dm, message("2", "hi again"));
  assert.match(String(dm.replies[0]), /couldn't reach Claude/);
  assert.equal(dm.replies[1], "hello");
});

test("image download is checked; oversized attachments are not downloaded", async () => {
  const handle = createHandler(async () => { assert.fail("No image interpretation yet"); }, emptyMemory, "test-project");
  const dm = chat("dm");
  let reads = 0;
  const attachment = { type: "attachment" as const, id: "image", name: "sample.png", mimeType: "image/png",
    size: 3, read: async () => { reads++; return Buffer.from("png"); },
    stream: async () => new ReadableStream(),
  };
  await handle(dm, { ...message("1", ""), content: attachment });
  assert.equal(reads, 1);
  assert.match(String(dm.replies[0]), /Photon download works/);
  await handle(dm, { ...message("2", ""), content: { ...attachment, size: 6 * 1024 * 1024 } });
  assert.equal(reads, 1);
  assert.match(String(dm.replies[1]), /smaller than 5 MB/);
});

test("successful delivery is saved once, after sending, with a stable document ID", async () => {
  const dm = chat("dm");
  const saves: Parameters<Memory["remember"]>[] = [];
  const handle = createHandler(async () => "got it", {
    ...emptyMemory,
    remember: async (...args) => { assert.equal(dm.replies.length, 1); saves.push(args); },
  }, "test-project");
  await handle(dm, message("1", "my home airport is RDU"));
  await handle(dm, message("1", "my home airport is RDU"));
  assert.equal(saves.length, 1);
  assert.equal(saves[0]?.[0], memoryNamespace("test-project", "imessage", "sender-1"));
  assert.match(saves[0]![1].id, /^msg_[a-f0-9]{64}$/);
  assert.equal(saves[0]![1].text, "my home airport is RDU");
  assert.equal(saves[0]![1].reply, "got it");
});

test("a restarted handler recalls saved context while local history is empty", async () => {
  const stored = new Map<string, string>();
  const memory: Memory = {
    recall: async (namespace) => stored.get(namespace) ?? "",
    remember: async (namespace, exchange) => { stored.set(namespace, exchange.text); },
  };
  await createHandler(async () => "got it", memory, "test-project")(chat("dm"), message("1", "my home airport is RDU"));
  const restarted = createHandler(async (messages, context) => {
    assert.deepEqual(messages, [{ role: "user", content: "which airport is home?" }]);
    assert.equal(context, "my home airport is RDU");
    return "RDU";
  }, memory, "test-project");
  const dm = chat("dm");
  await restarted(dm, message("2", "which airport is home?"));
  assert.equal(dm.replies[0], "RDU");
});

test("different senders cannot share memory or recent history even with the same chat ID", async () => {
  const namespaces: string[] = [];
  const stored = new Map<string, string>();
  const memory: Memory = {
    recall: async (namespace) => { namespaces.push(namespace); return stored.get(namespace) ?? ""; },
    remember: async (namespace, exchange) => { stored.set(namespace, exchange.text); },
  };
  let calls = 0;
  const handle = createHandler(async (messages, context) => {
    if (++calls === 2) {
      assert.equal(context, "");
      assert.deepEqual(messages, [{ role: "user", content: "what do you know about me?" }]);
    }
    return "hello";
  }, memory, "test-project");
  const dm = chat("reused-dm");
  await handle(dm, message("1", "my budget is private"));
  await handle(dm, { ...message("2", "what do you know about me?"), sender: { id: "sender-2", __platform: "imessage" } });
  assert.notEqual(namespaces[0], namespaces[1]);
});

test("memory outages preserve replies and short-term history without logging private errors", async (t) => {
  const logs: string[] = [];
  t.mock.method(console, "error", (value: string) => logs.push(value));
  const memory: Memory = {
    recall: async () => { throw new Error("secret-key and private-memory"); },
    remember: async () => { throw new Error("secret-key and private-memory"); },
  };
  const lengths: number[] = [];
  const handle = createHandler(async (messages, context) => {
    lengths.push(messages.length); assert.equal(context, ""); return "hello";
  }, memory, "test-project");
  const dm = chat("dm");
  await handle(dm, message("1", "hi"));
  await handle(dm, message("2", "hi again"));
  assert.deepEqual(dm.replies, ["hello", "hello"]);
  assert.deepEqual(lengths, [1, 3]);
  assert.equal(logs.length, 4);
  assert.doesNotMatch(logs.join("\n"), /secret-key|private-memory/);
});

test("failed model calls and unconfirmed deliveries are never saved as conversations", async () => {
  let saves = 0;
  const memory: Memory = { ...emptyMemory, remember: async () => { saves++; } };
  await createHandler(async () => { throw new Error("model offline"); }, memory, "test-project")(chat("dm"), message("1", "hello"));
  const dm = { ...chat("other-dm"), send: async () => { throw new Error("delivery uncertain"); } };
  await assert.rejects(createHandler(async () => "hello", memory, "test-project")(dm, message("2", "hi")), /delivery uncertain/);
  assert.equal(saves, 0);
});

test("proactive probe requires an explicit command and sends one delayed test only", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const handle = createHandler(async () => { assert.fail("Probe should not call Claude"); },
    { recall: async () => { assert.fail("Probe should not recall memory"); }, remember: async () => { assert.fail("Probe should not save preferences"); } }, "test-project");
  const dm = chat("dm");
  await handle(dm, message("1", "/test-proactive"));
  assert.equal(dm.replies.length, 1);
  t.mock.timers.tick(9999);
  assert.equal(dm.replies.length, 1);
  t.mock.timers.tick(1);
  await Promise.resolve();
  assert.equal(dm.replies.length, 2);
  assert.match(String(dm.replies[1]), /reminder test/);
  t.mock.timers.tick(60000);
  assert.equal(dm.replies.length, 2);
});

test("fresh context clears recent history while retaining saved memory", async () => {
  const lengths: number[] = [];
  const contexts: string[] = [];
  const handle = createHandler(async (messages, context) => { lengths.push(messages.length); contexts.push(context); return "hello"; },
    { ...emptyMemory, recall: async () => "home airport EWR" }, "test-project");
  const dm = chat("dm");
  await handle(dm, message("1", "hello"));
  await handle(dm, message("2", "/fresh"));
  await handle(dm, message("3", "where is home?"));
  assert.deepEqual(lengths, [1, 1]);
  assert.deepEqual(contexts, ["home airport EWR", "home airport EWR"]);
  assert.match(String(dm.replies[1]), /saved preferences/);
});

test("raw private messages never become Supermemory search queries", async () => {
  const queries: string[] = [];
  const handle = createHandler(async () => "got it", { ...emptyMemory, recall: async (_namespace, query) => { queries.push(query); return ""; } }, "test-project");
  await handle(chat("dm"), message("1", "my address is 123 Main Street and my password is secret"));
  assert.equal(queries.length, 1);
  assert.doesNotMatch(queries[0]!, /123 Main Street|password|secret/);
});
