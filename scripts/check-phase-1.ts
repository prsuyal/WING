import assert from "node:assert/strict";
import { loadEnvFile } from "node:process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createAnthropic } from "@ai-sdk/anthropic";
import { Supermemory } from "supermemory";
import { createDatabase } from "../src/database.ts";
import { createHandler } from "../src/handler.ts";
import { createService } from "../src/service.ts";
import { createAgent } from "../src/agent.ts";
import { createProfileStore, confirmedFacts, type Trip } from "../src/profile.ts";
import { createMemory, memoryNamespace, tripMemoryNamespace } from "../src/memory.ts";
import { createMemoryWorker, permittedMemory } from "../src/memory-worker.ts";
import type { Actor } from "../src/contracts.ts";

loadEnvFile();
const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) },
});
const database = createDatabase(client);
const store = createProfileStore(client);
const supermemory = new Supermemory({ maxRetries: 0 });
const model = createAnthropic({ headers: process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : undefined })(process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5");
const project = process.env.PROJECT_ID!;
const run = randomUUID();
const sender = `phase1_${run}`;
const namespace = memoryNamespace(project, "imessage", sender);
const owners: string[] = [];
const namespaces = new Set<string>([namespace]);
const passed: string[] = [];
let stage = "synthetic_owner";
let memoryUnavailable = true;
const recall = createMemory(supermemory, async (scope, evidence) => {
  const { data, error } = await client.from("wing_users").select("id").eq("identity_key", scope).single();
  assert.equal(error, null);
  await store.evidence(data!.id, evidence);
});
function pipeline() {
  return createService(database, project, createHandler(createAgent(model, store), {
    recall: async (scope, query) => {
      if (memoryUnavailable) {
        const { data } = await client.from("wing_users").select("id").eq("identity_key", scope).single();
        await store.evidence(data!.id, { origin: "injected outage", context: "", sourceIds: [], degraded: true });
        return "";
      }
      return recall.recall(scope, query);
    }, remember: async () => {},
  }, project));
}
let service = pipeline();
async function ask(text: string) {
  const replies: string[] = [];
  await service({ id: run, type: "dm", responding: async <T>(fn: () => T | Promise<T>) => fn(), send: async (reply) => { replies.push(reply); } },
    { id: randomUUID(), direction: "inbound", sender: { id: sender, __platform: "imessage" }, content: { type: "text", text } });
  assert.ok(replies.length);
  assert.ok(!replies.some((reply) => reply.includes("couldn't reach Claude")), "Agent generation failed");
  return replies.join("\n");
}
function check(name: string) { passed.push(name); console.log(JSON.stringify({ check: name, status: "passed" })); }
async function source(owner: string, identity: string, text: string, handled = true): Promise<Actor> {
  const received = await database.receive(identity, run, randomUUID(), { type: "text", text });
  assert.equal(received.userId, owner);
  if (handled) await database.status(owner, received.messageId, "handled");
  return { userId: owner, namespace: identity, sourceMessageId: received.messageId, sourceText: text };
}
try {
  const seed = await database.receive(namespace, run, randomUUID(), { type: "text", text: "synthetic owner" });
  const owner = seed.userId; owners.push(owner);
  await database.status(owner, seed.messageId, "handled");
  const otherNamespace = memoryNamespace(project, "imessage", `other_${run}`);
  namespaces.add(otherNamespace);
  const other = await database.receive(otherNamespace, run, randomUUID(), { type: "text", text: "synthetic other" });
  owners.push(other.userId);
  await database.status(other.userId, other.messageId, "handled");

  stage = "claude_onboarding";
  const onboardingReply = await ask("I'm Taylor, I study at Duke in Durham. My timezone is America/New_York. I depart from RDU and home is EWR in Newark. My usual budget is $200 per person for round-trip airfare. I prefer nonstop, carry-on baggage, economy, and arriving before dinner with family. Keep notifications off. Please save these general preferences.");
  let state = await store.state(owner);
  if (!Object.keys(state.profile).length) console.error(JSON.stringify({ syntheticOnboardingReply: onboardingReply }));
  assert.deepEqual(confirmedFacts(state.profile), { name: "Taylor", school: "Duke", schoolCity: "Durham", timeZone: "America/New_York", departureAirport: "RDU", homeAirport: "EWR", homeCity: "Newark", budgetCents: 20_000, budgetMeaning: "round_trip_airfare_per_person", nonstop: true, baggage: "carry_on", cabin: "economy", arrivalPreference: confirmedFacts(state.profile).arrivalPreference, notifications: false });
  assert.match(String(confirmedFacts(state.profile).arrivalPreference), /dinner.*family/i);
  check("real_claude_onboarding_and_immediate_database_fallback");

  stage = "tentative_correction";
  await ask("Maybe JFK instead of EWR as my usual home airport, I'm not sure yet. Keep that tentative until I confirm.");
  state = await store.state(owner);
  assert.equal(confirmedFacts(state.profile).homeAirport, "EWR");
  assert.equal(state.profile.homeAirport?.tentative?.value, "JFK");
  await ask("I've decided: my general home airport is JFK now. Also layovers are okay as my general preference; nonstop is no longer required. Please save those corrections.");
  state = await store.state(owner);
  assert.equal(confirmedFacts(state.profile).homeAirport, "JFK");
  assert.equal(confirmedFacts(state.profile).nonstop, false);
  assert.equal(state.profile.homeAirport?.tentative, undefined);
  check("tentative_facts_and_confirmed_corrections");

  stage = "two_trips";
  await ask("Create a trip titled home visit to visit family, departing October 23 2026 and returning October 26 2026. For this trip only, use EWR and a $180 round-trip airfare budget per person. Do not change my general profile.");
  await ask("Create a separate trip titled Boston weekend to see a friend, departing November 6 2026 and returning November 9 2026. For this trip only use BOS and a $250 round-trip airfare budget per person. Do not change my general profile.");
  state = await store.state(owner);
  assert.equal(state.trips.length, 2);
  const home = state.trips.find((trip) => trip.title.toLowerCase() === "home visit")!;
  const boston = state.trips.find((trip) => trip.title.toLowerCase() === "boston weekend")!;
  assert.ok(home && boston);
  assert.equal(confirmedFacts(home.facts).budgetCents, 18_000);
  assert.equal(confirmedFacts(home.facts).arrivalAirport, "EWR");
  assert.equal(confirmedFacts(boston.facts).budgetCents, 25_000);
  assert.equal(confirmedFacts(boston.facts).arrivalAirport, "BOS");
  assert.equal(confirmedFacts(state.profile).budgetCents, 20_000);
  assert.equal(confirmedFacts(state.profile).homeAirport, "JFK");
  for (const trip of state.trips) namespaces.add(tripMemoryNamespace(namespace, trip.id));
  await ask("For home visit only, return October 27 2026 instead. Leave Boston weekend unchanged.");
  state = await store.state(owner);
  assert.equal(confirmedFacts(state.trips.find((trip) => trip.id === home.id)!.facts).returnDate, "2026-10-27");
  assert.equal(confirmedFacts(state.trips.find((trip) => trip.id === boston.id)!.facts).returnDate, "2026-11-09");
  const beforeAmbiguity = state.trips;
  const clarification = await ask("For that trip, change the budget to $150.");
  assert.deepEqual((await store.state(owner)).trips, beforeAmbiguity);
  assert.match(clarification, /which|home visit.*Boston|Boston.*home visit/i);
  check("two_trips_explicit_references_and_ambiguity");

  stage = "private_addresses";
  await ask("My campus pickup address is 123 Synthetic Street, Durham NC. What can you do with that?");
  state = await store.state(owner);
  assert.ok(state.pendingAddress);
  assert.deepEqual(state.savedAddressKinds, []);
  await ask("yes");
  assert.deepEqual((await store.state(owner)).savedAddressKinds, ["campus"]);
  await ask("For home visit only, use 456 Temporary Avenue, Durham NC as the pickup this time. Keep my saved campus address unchanged.");
  const { data: pickup, error: pickupError } = await client.from("wing_trips").select("pickup_override").eq("owner_id", owner).eq("id", home.id).single();
  assert.equal(pickupError, null);
  assert.match(pickup!.pickup_override.address, /456 Temporary Avenue/);
  const { data: addresses, error: addressError } = await client.from("wing_addresses").select("address,confirmed").eq("owner_id", owner);
  assert.equal(addressError, null);
  assert.equal(addresses!.length, 1);
  assert.match(addresses![0]!.address, /123 Synthetic Street/);
  assert.equal(addresses![0]!.confirmed, true);
  check("address_consent_and_temporary_pickup_isolation");

  stage = "ownership_and_versions";
  const currentHome = (await store.state(owner)).trips.find((trip) => trip.id === home.id)!;
  const change = await source(owner, namespace, "home visit budget is $175");
  await store.patch(change, { budgetCents: 17_500 }, "confirmed", currentHome);
  await assert.rejects(store.patch(change, { budgetCents: 10_000 }, "confirmed", currentHome));
  const stranger = await source(other.userId, otherNamespace, "change someone else's budget");
  await assert.rejects(store.patch(stranger, { budgetCents: 1 }, "confirmed", currentHome));
  await assert.rejects(store.patch({ ...change, sourceMessageId: stranger.sourceMessageId }, { budgetCents: 1 }, "confirmed"));
  await assert.rejects(store.activate(other.userId, home.id));
  assert.deepEqual(confirmedFacts((await store.state(other.userId)).profile), {});
  check("real_database_ownership_and_stale_version_rejection");

  stage = "indexing_retry";
  const pendingSource = await source(owner, namespace, "my name is Taylor", false);
  await store.patch(pendingSource, { name: "Taylor" }, "confirmed");
  const workerFailed = createMemoryWorker(client, { add: async () => { throw new Error("injected indexing outage"); } });
  await workerFailed(owner);
  const { data: waiting, error: waitingError } = await client.from("wing_memory_documents").select("state,attempts,content,source_message_id").eq("owner_id", owner);
  assert.equal(waitingError, null);
  assert.ok(waiting!.some((document) => document.state === "pending" && document.attempts > 0));
  assert.equal(waiting!.find((document) => document.source_message_id === pendingSource.sourceMessageId)?.attempts, 0);
  for (const document of waiting!) {
    permittedMemory(document.content);
    assert.ok(!/Synthetic Street|Temporary Avenue|sourceText|password|apiKey|calendar/i.test(document.content));
  }
  assert.equal(confirmedFacts((await store.state(owner)).profile).homeAirport, "JFK");
  await database.status(owner, pendingSource.sourceMessageId, "handled");
  const { error: dueError } = await client.from("wing_memory_documents").update({ due_at: new Date().toISOString() }).eq("owner_id", owner).eq("state", "pending");
  assert.equal(dueError, null);
  const freshWorker = createMemoryWorker(client, supermemory);
  for (let batch = 0; batch < 10; batch++) {
    await freshWorker(owner);
    const { data: undone, error } = await client.from("wing_memory_documents").select("id").eq("owner_id", owner).neq("state", "done");
    assert.equal(error, null);
    if (!undone!.length) break;
    assert.ok(batch < 9, "Memory queue did not drain");
  }
  check("durable_indexing_retry_source_gating_and_private_content_exclusion");

  stage = "live_supermemory_retrieval";
  let context = "";
  for (let attempt = 0; attempt < 12; attempt++) {
    context = await recall.recall(namespace, "arrival preference before dinner with family");
    if (/dinner|family/i.test(context)) break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  assert.match(context, /dinner|family/i);
  const evidence = (await store.state(owner)).memoryEvidence;
  assert.ok(evidence.sourceIds.length);
  assert.equal(evidence.degraded, false);
  assert.equal(await recall.recall(otherNamespace, "Taylor dinner family preferences"), "");
  check("real_supermemory_contextual_retrieval_provenance_and_user_isolation");

  stage = "restart_and_fresh_context";
  memoryUnavailable = false;
  await ask("/fresh");
  service = pipeline();
  const profileReply = await ask("/profile");
  assert.match(profileReply, /JFK/);
  assert.match(profileReply, /20000/);
  assert.match(profileReply, /campus/);
  const reply = await ask("I want to plan another trip home. Do you remember my home airport and arrival preference?");
  assert.match(reply, /JFK/);
  assert.match(reply, /dinner|family/i);
  const evidenceReply = await ask("/memory");
  assert.match(evidenceReply, /retrieval checked/);
  assert.ok(!/source references: none/.test(evidenceReply));
  assert.equal((await store.state(owner)).trips.filter((trip: Trip) => [home.id, boston.id].includes(trip.id)).length, 2);
  check("fresh_context_and_recreated_service_preserve_saved_facts");

  stage = "record_evidence";
  mkdirSync("verification", { recursive: true });
  writeFileSync("verification/phase-1.json", JSON.stringify({ phase: 1, status: "verified_awaiting_deployment", checkedAt: new Date().toISOString(), passed,
    integration: { claude: "real API", supabase: "real hosted database", supermemory: "real ingestion/profile/search", messaging: "captured transport; live Photon/iPhone verified in Phase 0" },
    controls: ["/fresh", "/profile", "/trips", "/memory"], scopeChanges: ["Google Calendar only; iCloud deferred", "iMessage controls replace a separate demo dashboard"], pending: ["Phase 1 Railway deployment and health"] }, null, 2) + "\n");
} catch (error) {
  if (error instanceof assert.AssertionError) console.error(JSON.stringify({ syntheticAssertion: { operator: error.operator, actual: typeof error.actual === "object" ? "structured state mismatch" : error.actual, expected: typeof error.expected === "object" ? "expected structured state" : error.expected } }));
  console.error(JSON.stringify({ stage, status: "failed", privateContentLogged: false }));
  process.exitCode = 1;
} finally {
  for (const scope of namespaces) {
    try { await supermemory.namespaces.delete(scope, {}, { timeoutInSeconds: 10, maxRetries: 0 }); }
    catch (error) { if ((error as { statusCode?: number }).statusCode !== 404) { console.error(JSON.stringify({ syntheticMemoryCleanup: "failed", statusCode: (error as { statusCode?: number }).statusCode })); process.exitCode = 1; } }
  }
  if (owners.length) {
    const { error } = await client.from("wing_users").delete().in("id", owners);
    if (error) { console.error("Synthetic database cleanup failed."); process.exitCode = 1; }
  }
  console.log(JSON.stringify({ syntheticCleanup: process.exitCode ? "check required" : "complete", passed: passed.length }));
}
