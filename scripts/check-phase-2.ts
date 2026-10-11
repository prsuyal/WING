import assert from "node:assert/strict";
import { loadEnvFile } from "node:process";
import { randomUUID, createHash } from "node:crypto";
import { once } from "node:events";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createAnthropic } from "@ai-sdk/anthropic";
import { Supermemory } from "supermemory";
import { createCalendar, type Calendar } from "../src/calendar.ts";
import { createHttpServer } from "../src/http.ts";
import { createDatabase } from "../src/database.ts";
import { credentialVault, tokenHash } from "../src/credentials.ts";
import { createScheduleStore, createScheduleVision, formatSchedule } from "../src/schedule-store.ts";
import { createProfileStore } from "../src/profile.ts";
import { createAgent } from "../src/agent.ts";
import { createHandler } from "../src/handler.ts";
import { createService } from "../src/service.ts";
import { memoryNamespace } from "../src/memory.ts";
import { expandSchedule, planningRange, availability, type Schedule } from "../src/schedule.ts";
import type { Actor } from "../src/contracts.ts";

loadEnvFile();
const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) } });
const database = createDatabase(client), schedules = createScheduleStore(client);
const run = randomUUID(), sender = `phase2_${run}`, namespace = memoryNamespace(process.env.PROJECT_ID!, "imessage", sender);
const owners: string[] = [], passed: string[] = [], namespaces = [namespace];
let stage = "setup", revoked = false, loseResponse = false, postCount = 0, tokenCount = 0, challenge = "";
const googleEvents = new Map<string, any>();
const scopeList = ["calendar.calendarlist.readonly", "calendar.events.readonly", "calendar.events.owned"].map((scope) => `https://www.googleapis.com/auth/${scope}`);
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const google: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/token") {
    tokenCount++;
    if (revoked) return response({ error: "invalid_grant" }, 400);
    const body = new URLSearchParams(String(init?.body));
    if (body.get("grant_type") === "authorization_code") assert.equal(createHash("sha256").update(body.get("code_verifier")!).digest("base64url"), challenge);
    return response({ access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600, scope: scopeList.join(" ") });
  }
  if (url.pathname === "/revoke") return response({});
  assert.equal(url.hostname, "www.googleapis.com");
  if (revoked) return response({ error: "revoked" }, 401);
  assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-access");
  if (url.pathname.endsWith("calendarList")) return response({ items: [{ id: "synthetic-calendar", summary: "Synthetic primary", primary: true, timeZone: "America/New_York", accessRole: "owner" }, { id: "read-only", summary: "Read only", timeZone: "America/New_York", accessRole: "reader" }] });
  if (url.pathname.endsWith("/events") && init?.method === "POST") {
    postCount++;
    const event = JSON.parse(String(init.body)); googleEvents.set(event.id, event);
    if (loseResponse) { loseResponse = false; throw new Error("Synthetic timeout after Google accepted the event"); }
    return response(event);
  }
  if (/\/events\/[^/]+$/.test(url.pathname)) {
    const event = googleEvents.get(url.pathname.split("/").at(-1)!);
    return event ? response(event) : response({ error: "not found" }, 404);
  }
  assert.equal(url.searchParams.get("singleEvents"), "true");
  assert.ok(url.searchParams.has("timeMin") && url.searchParams.has("timeMax"));
  if (!url.searchParams.has("pageToken")) return response({ items: [], nextPageToken: "second-page", timeZone: "America/New_York" });
  return response({ timeZone: "America/New_York", items: [{ id: "class-instance", summary: "Synthetic lecture", start: { dateTime: "2026-10-26T09:00:00-04:00" }, end: { dateTime: "2026-10-26T10:00:00-04:00" } }, { id: "cancelled-instance", status: "cancelled" }] });
};
let calendar: Calendar;
const server = createHttpServer((request, response) => calendar.http(request, response));
server.listen(0, "127.0.0.1"); await once(server, "listening");
const address = server.address(); assert.ok(address && typeof address !== "string");
const baseUrl = `http://127.0.0.1:${address.port}`;
calendar = createCalendar(client, { baseUrl, clientId: "synthetic-client", clientSecret: "synthetic-secret", encryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY!, fetch: google });
function done(name: string) { passed.push(name); console.log(JSON.stringify({ check: name, status: "passed" })); }
async function source(owner: string, ns: string, text: string): Promise<Actor> {
  const message = await database.receive(ns, run, randomUUID(), { type: "text", text }); assert.equal(message.userId, owner);
  await database.status(owner, message.messageId, "handled");
  return { userId: owner, sourceMessageId: message.messageId, namespace: ns, sourceText: text };
}
async function present(actor: Actor, text: string) {
  const id = await database.prepareReply({ userId: actor.userId, messageId: actor.sourceMessageId, isNew: true }, run, text, 0);
  await database.status(actor.userId, id, "sent");
}
try {
  const first = await database.receive(namespace, run, randomUUID(), { type: "text", text: "Synthetic Phase 2 identity" });
  owners.push(first.userId); await database.status(first.userId, first.messageId, "handled");
  const owner = first.userId;
  const otherNs = memoryNamespace(process.env.PROJECT_ID!, "imessage", `other_phase2_${run}`); namespaces.push(otherNs);
  const other = await database.receive(otherNs, run, randomUUID(), { type: "text", text: "Synthetic second owner" }); owners.push(other.userId);
  const actor = await source(owner, namespace, "/connect-calendar");
  stage = "oauth_browser_binding";
  const link = await calendar.link(actor), token = new URL(link).searchParams.get("t")!;
  const landing = await fetch(link); assert.equal(landing.status, 200);
  assert.equal(landing.headers.get("referrer-policy"), "same-origin");
  assert.match(landing.headers.get("content-security-policy")!, /form-action 'self' https:\/\/accounts\.google\.com;/);
  const cookie = landing.headers.get("set-cookie")!.split(";")[0]!;
  assert.match(await landing.text(), /Connect Google Calendar/);
  assert.equal((await fetch(link, { method: "POST", headers: { Origin: "https://attacker.invalid", Cookie: cookie }, redirect: "manual" })).status, 400);
  const redirect = await fetch(link, { method: "POST", headers: { Origin: baseUrl, Cookie: cookie }, redirect: "manual" }); assert.equal(redirect.status, 303);
  assert.equal(redirect.headers.get("referrer-policy"), "no-referrer");
  const auth = new URL(redirect.headers.get("location")!); challenge = auth.searchParams.get("code_challenge")!;
  assert.equal(auth.origin, "https://accounts.google.com"); assert.equal(auth.searchParams.get("redirect_uri"), `${baseUrl}/auth/google/callback`);
  const callback = `${baseUrl}/auth/google/callback?code=synthetic-code&state=${auth.searchParams.get("state")}`;
  assert.equal((await fetch(callback, { headers: { Cookie: `wing_oauth=${"x".repeat(43)}` } })).status, 400); assert.equal(tokenCount, 0);
  assert.equal((await fetch(callback, { headers: { Cookie: cookie } })).status, 200); assert.equal(tokenCount, 1);
  assert.equal((await fetch(callback, { headers: { Cookie: cookie } })).status, 400);
  assert.equal((await fetch(link)).status, 400);
  const { data: encrypted, error: encryptedError } = await client.from("wing_calendar_connections").select("credentials_cipher").eq("owner_id", owner).single(); assert.equal(encryptedError, null);
  assert.ok(!encrypted!.credentials_cipher.includes("synthetic-access"));
  assert.throws(() => credentialVault(process.env.CREDENTIAL_ENCRYPTION_KEY!).open(other.userId, encrypted!.credentials_cipher));
  const expired = await calendar.link(await source(owner, namespace, "/connect-calendar"));
  const { error: expiryError } = await client.from("wing_calendar_links").update({ expires_at: "2000-01-01T00:00:00Z" }).eq("owner_id", owner).eq("token_hash", tokenHash(new URL(expired).searchParams.get("t")!)); assert.equal(expiryError, null);
  assert.equal((await fetch(expired)).status, 400);
  await assert.rejects(calendar.link({ ...actor, userId: other.userId }));
  assert.equal((await calendar.state(other.userId)).status, "not_connected");
  done("oauth_state_pkce_cookie_origin_expiry_replay_and_encrypted_owner_binding");

  stage = "calendar_read_and_failure";
  await calendar.select(await source(owner, namespace, "/use-calendar 1"), ["1"]);
  const range = planningRange("2026-10-26", "2026-10-26", "America/New_York");
  const synced = await calendar.sync(owner, range); assert.equal(synced.healthy, true); assert.equal(synced.windows.length, 1);
  assert.equal(synced.windows[0]!.start, "2026-10-26T13:00:00Z");
  revoked = true;
  const failed = await calendar.sync(owner, range); assert.equal(failed.healthy, false); assert.equal(failed.unknown, true); assert.deepEqual(failed.windows, []);
  assert.ok(availability(range, failed.windows, failed.healthy, failed.unknown).every((slot) => slot.status === "unknown"));
  revoked = false; assert.equal((await calendar.sync(owner, range)).healthy, true);
  done("paginated_calendar_reads_and_revoked_credentials_become_unknown");

  stage = "approved_event_deduplication";
  const proposal = await source(owner, namespace, "/calendar-test"), review = await calendar.proposeTest(proposal);
  assert.equal(postCount, 0);
  const { data: action } = await client.from("wing_calendar_actions").select("id").eq("owner_id", owner).eq("source_message_id", proposal.sourceMessageId).single(); assert.ok(action);
  await assert.rejects(calendar.approveTest(await source(owner, namespace, "yes"), action.id));
  await present(proposal, review);
  const approved = await source(owner, namespace, "yes");
  assert.match(await calendar.approveTest(approved, action.id), /added and read back/); assert.equal(postCount, 1);
  assert.match(await calendar.approveTest(await source(owner, namespace, "yes"), action.id), /already created/); assert.equal(postCount, 1);
  await assert.rejects(calendar.approveTest(await source(other.userId, otherNs, "yes"), action.id));
  done("approved_exact_review_calendar_write_readback_and_duplicate_owner_checks");

  stage = "uncertain_event_reconciliation";
  const second = await source(owner, namespace, "/calendar-test"), secondReview = await calendar.proposeTest(second);
  const { data: secondAction } = await client.from("wing_calendar_actions").select("id").eq("owner_id", owner).eq("source_message_id", second.sourceMessageId).single(); assert.ok(secondAction);
  await present(second, secondReview); loseResponse = true;
  assert.match(await calendar.approveTest(await source(owner, namespace, "yes"), secondAction.id), /couldn't confirm/); assert.equal(postCount, 2);
  const reReview = await source(owner, namespace, "/calendar-review"); await present(reReview, await calendar.reviewTest(owner, secondAction.id));
  assert.match(await calendar.approveTest(await source(owner, namespace, "yes"), secondAction.id), /added and read back/); assert.equal(postCount, 2);
  await calendar.select(await source(owner, namespace, "/use-calendar 2"), ["2"]);
  await assert.rejects(calendar.proposeTest(await source(owner, namespace, "/calendar-test")));
  await assert.rejects(calendar.approveTest(await source(owner, namespace, "yes"), action.id));
  await calendar.select(await source(owner, namespace, "/use-calendar 1"), ["1"]);
  done("uncertain_write_reconciliation_readonly_and_stale_selection_rejection");

  stage = "real_claude_schedule_and_vision";
  const { error: profileError } = await client.from("wing_profiles").upsert({ owner_id: owner, facts: Object.fromEntries(Object.entries({ name: "Taylor", timeZone: "America/New_York", departureAirport: "RDU", homeAirport: "EWR", budgetCents: 20_000, budgetMeaning: "round_trip_airfare_per_person", baggage: "carry_on", nonstop: true, notifications: false }).map(([key, value]) => [key, { confirmed: { value, sourceMessageId: first.messageId, updatedAt: new Date().toISOString() } }])) }); assert.equal(profileError, null);
  const model = createAnthropic({ headers: process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : undefined })(process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5");
  const profiles = createProfileStore(client), vision = createScheduleVision(model, schedules, { calendar, profiles });
  const create = () => createService(database, process.env.PROJECT_ID!, createHandler(createAgent(model, profiles, { calendar, schedules }), { recall: async () => "", remember: async () => {} }, process.env.PROJECT_ID!, vision));
  let service = create();
  const chat = { id: run, type: "dm" as const, responding: async <T>(fn: () => T | Promise<T>) => fn(), send: async (text: string) => { replies.push(text); } };
  let replies: string[] = [];
  const senderInfo = { id: sender, __platform: "imessage" };
  async function ask(text: string) { replies = []; await service(chat, { id: randomUUID(), sender: senderInfo, direction: "inbound", content: { type: "text", text } }); assert.ok(replies.length); assert.ok(!replies.join().includes("couldn't reach Claude")); return replies.join("\n"); }
  assert.match(await ask("Stage this schedule only: for October 12 through December 18, 2026, in America/New_York, I have Mathematics class every Monday and Wednesday 09:00 to 10:00. No exceptions. Show the preview; don't confirm it yet."), /here's what i read/);
  let rows = await schedules.state(owner), textCandidate = rows.find((row) => row.status === "candidate")!; assert.ok(textCandidate);
  assert.equal(textCandidate.data.timeZone, "America/New_York"); assert.deepEqual([...textCandidate.data.rules[0]!.weekdays].sort(), [1, 3]);
  assert.match(await ask("yes"), /confirm|sav/i);
  rows = await schedules.state(owner); assert.equal(rows.find((row) => row.id === textCandidate.id)!.status, "confirmed");
  const bytes = readFileSync(process.argv[2] || new URL("./fixtures/schedule.png", import.meta.url));
  replies = [];
  await service(chat, { id: randomUUID(), sender: senderInfo, direction: "inbound", content: { type: "attachment", id: "synthetic-image", name: "schedule.png", mimeType: "image/png", size: bytes.length, read: async () => bytes, stream: async () => new ReadableStream() } });
  assert.match(replies.join(), /here's what i read/);
  rows = await schedules.state(owner); const imageCandidate = rows.find((row) => row.origin === "screenshot")!; assert.ok(imageCandidate);
  assert.equal(imageCandidate.status, "candidate"); assert.ok(imageCandidate.data.rules.every((rule) => rule.kind === "class"));
  assert.deepEqual([...new Set(imageCandidate.data.rules.flatMap((rule) => rule.weekdays))].sort(), [1, 3, 5]);
  assert.equal(imageCandidate.data.startDate, "2026-10-12"); assert.equal(imageCandidate.data.endDate, "2026-12-18");
  assert.equal(imageCandidate.data.timeZone, "America/New_York");
  const imageConfirmation = await ask("yes");
  if ((await schedules.state(owner)).find((row) => row.id === imageCandidate.id)!.status !== "confirmed") console.error(JSON.stringify({ syntheticImageConfirmation: imageConfirmation, syntheticNotes: imageCandidate.data.notes }));
  assert.equal((await schedules.state(owner)).find((row) => row.id === imageCandidate.id)!.status, "confirmed");
  const screenshot = (await schedules.state(owner)).find((row) => row.id === imageCandidate.id)!;
  assert.equal(expandSchedule(screenshot.data, planningRange("2026-10-23", "2026-10-23", "America/New_York"), "image")[0]!.start, "2026-10-23T18:00:00Z");
  done("real_claude_text_intake_and_vision_with_separate_preview_confirmation");

  stage = "restart_ownership_and_invalid_confirmation";
  service = create(); await ask("/fresh"); assert.match(await ask("/schedule"), /saved your schedule/);
  await assert.rejects(schedules.revise(await source(other.userId, otherNs, "change the date"), imageCandidate.id, screenshot.version, { endDate: "2026-12-19" }));
  await assert.rejects(schedules.revise(await source(owner, namespace, "change the date"), imageCandidate.id, 1, { endDate: "2026-12-19" }));
  const candidateData: Schedule = { ...screenshot.data, startDate: null, timeZone: null };
  const incomplete = await schedules.stage(await source(owner, namespace, "this screenshot has no dates"), candidateData, "screenshot");
  await assert.rejects(schedules.confirm(await source(owner, namespace, "yes"), incomplete.id, incomplete.version));
  const { data: memoryDocs, error: memoryError } = await client.from("wing_memory_documents").select("content").eq("owner_id", owner); assert.equal(memoryError, null);
  assert.ok((memoryDocs ?? []).every((doc) => !/Mathematics|Chemistry|rules|weekdays|calendar/i.test(doc.content)));
  await calendar.disconnect(await source(owner, namespace, "/disconnect-calendar")); assert.equal((await calendar.sync(owner, range)).unknown, true);
  done("restart_schedule_ownership_stale_confirmation_and_schedule_memory_exclusion");

  mkdirSync("verification", { recursive: true });
  const checkpointPath = "verification/phase-2.json";
  const previous = JSON.parse(readFileSync(checkpointPath, "utf8"));
  writeFileSync(checkpointPath, JSON.stringify({ ...previous, checkedAt: new Date().toISOString(), passed }, null, 2) + "\n");
} catch (error) {
  console.error(JSON.stringify({ stage, status: "failed", assertion: error instanceof assert.AssertionError ? { operator: error.operator, actual: typeof error.actual === "object" ? "structured mismatch" : error.actual, expected: typeof error.expected === "object" ? "structured value" : error.expected } : undefined, privateContentLogged: false })); process.exitCode = 1;
} finally {
  if (owners.length) {
    const { data: attachments } = await client.from("wing_messages").select("body").in("owner_id", owners).eq("direction", "inbound");
    const paths = (attachments ?? []).map((row) => row.body.storagePath).filter((path) => typeof path === "string");
    if (paths.length) { const { error } = await client.storage.from("wing-attachments").remove(paths); if (error) { console.error("Synthetic attachment cleanup failed"); process.exitCode = 1; } }
    const { error } = await client.from("wing_users").delete().in("id", owners); if (error) { console.error("Synthetic owner cleanup failed"); process.exitCode = 1; }
  }
  const memory = new Supermemory({ maxRetries: 0 });
  for (const ns of namespaces) { try { await memory.namespaces.delete(ns, {}, { timeoutInSeconds: 10 }); } catch (error) { if ((error as { statusCode?: number }).statusCode !== 404) { console.error("Synthetic memory cleanup failed"); process.exitCode = 1; } } }
  server.close(); await once(server, "close");
  console.log(JSON.stringify({ checks: passed.length, syntheticCleanup: process.exitCode ? "check required" : "complete" }));
}
