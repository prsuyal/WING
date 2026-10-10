import assert from "node:assert/strict";
import { loadEnvFile } from "node:process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createDatabase } from "../src/database.ts";
import { memoryNamespace } from "../src/memory.ts";

loadEnvFile();
const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) },
});
const database = createDatabase(client);
const testId = randomUUID();
const owners: string[] = [];
const paths: string[] = [];
let stage = "receive";
try {
  const identity = memoryNamespace(process.env.PROJECT_ID!, "imessage", `foundation_${testId}`);
  const a = await database.receive(identity, testId, "first", { type: "text", text: "synthetic hello" });
  owners.push(a.userId);
  assert.ok(a.isNew);
  const fresh = createDatabase(createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } }));
  const replay = await fresh.receive(identity, testId, "first", { type: "text", text: "synthetic hello" });
  assert.equal(replay.isNew, false);
  assert.equal(replay.messageId, a.messageId);
  assert.equal(replay.userId, a.userId);
  stage = "concurrent_deduplication";
  const duplicates = await Promise.all(Array.from({ length: 10 }, () => database.receive(identity, testId, "concurrent", { type: "text", text: "synthetic replay" })));
  assert.equal(duplicates.filter((item) => item.isNew).length, 1);
  stage = "ownership";
  const b = await database.receive(memoryNamespace(process.env.PROJECT_ID!, "imessage", `other_${testId}`), testId, "first", { type: "text", text: "synthetic other user" });
  owners.push(b.userId);
  assert.notEqual(a.userId, b.userId);
  await assert.rejects(database.status(b.userId, a.messageId, "handled"));
  await assert.rejects(database.prepareReply({ ...a, userId: b.userId }, testId, "wrong owner", 0));
  const reply = await database.prepareReply(a, testId, "synthetic reply", 0);
  await database.status(a.userId, reply, "sent");
  await database.status(a.userId, a.messageId, "handled");
  const { data: persisted, error: readError } = await client.from("wing_messages").select("status,body").eq("owner_id", a.userId).eq("id", a.messageId).single();
  assert.equal(readError, null);
  assert.equal(persisted?.status, "handled");
  assert.equal(persisted?.body.text, "synthetic hello");
  stage = "private_image";
  const image = await database.receive(identity, testId, "image", { type: "attachment", mimeType: "image/png", name: "synthetic.png" });
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jI1sAAAAASUVORK5CYII=", "base64");
  await assert.rejects(database.saveImage({ ...image, userId: b.userId }, "image/png", bytes));
  const path = await database.saveImage(image, "image/png", bytes);
  paths.push(path);
  const { data: downloaded, error: downloadError } = await client.storage.from("wing-attachments").download(path);
  assert.equal(downloadError, null);
  assert.deepEqual(Buffer.from(await downloaded!.arrayBuffer()), bytes);
  const { data: publicLink } = client.storage.from("wing-attachments").getPublicUrl(path);
  assert.ok(!(await fetch(publicLink.publicUrl, { signal: AbortSignal.timeout(15_000) })).ok);
  stage = "record_evidence";
  mkdirSync("verification", { recursive: true });
  const previous = existsSync("verification/phase-0.json") ? JSON.parse(readFileSync("verification/phase-0.json", "utf8")) : {};
  writeFileSync("verification/phase-0.json", JSON.stringify({
    ...previous, phase: 0, status: previous.status === "complete" ? "complete" : "awaiting_live_gates", checkedAt: new Date().toISOString(),
    passed: [...new Set([...(previous.passed ?? []), "live_supabase_persistence", "fresh_client_replay_suppression", "concurrent_event_deduplication", "cross_owner_access_rejected", "private_image_upload_download", "public_image_access_denied"])],
    pending: previous.status === "complete" ? [] : ["real_phone_text_and_image_on_new_service", "proactive_delivery_probe", "railway_https_deployment"],
    scopeChanges: ["iCloud deferred by user; Google Calendar only", "README stays empty; checkpoints stored as JSON"],
  }, null, 2) + "\n");
  console.log("Live foundation regression checks passed; earlier integration evidence preserved.");
} catch {
  console.error(`Foundation check failed at ${stage}; no private content or credentials logged.`);
  process.exitCode = 1;
} finally {
  if (paths.length) {
    const { error } = await client.storage.from("wing-attachments").remove(paths);
    if (error) { console.error("Synthetic image cleanup failed."); process.exitCode = 1; }
  }
  if (owners.length) {
    const { error } = await client.from("wing_users").delete().in("id", owners);
    if (error) { console.error("Synthetic record cleanup failed."); process.exitCode = 1; }
  }
}
