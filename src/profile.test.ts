import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { confirmedFacts, profilePatchSchema, tripPatchSchema, resolveTrip, createProfileStore, type Trip } from "./profile.ts";
import { permittedMemory } from "./memory-worker.ts";
import type { Actor } from "./contracts.ts";
import { createAgentTools } from "./agent.ts";

const actor: Actor = { userId: "00000000-0000-4000-8000-000000000001", sourceMessageId: "00000000-0000-4000-8000-000000000002", namespace: "wing_user_test", sourceText: "my home airport is EWR" };
const fact = (value: unknown) => ({ value, sourceMessageId: actor.sourceMessageId, updatedAt: "2026-10-10T00:00:00Z" });
const home: Trip = { id: "00000000-0000-4000-8000-000000000003", title: "home", purpose: "visit family", facts: { outboundDate: { confirmed: fact("2026-10-23") }, returnDate: { confirmed: fact("2026-10-26") } }, version: 1, status: "planning" };
const boston: Trip = { ...home, id: "00000000-0000-4000-8000-000000000004", title: "Boston", purpose: "weekend away", facts: {} };

test("confirmed facts win over tentative corrections until the user confirms", () => {
  assert.deepEqual(confirmedFacts({ homeAirport: { confirmed: fact("EWR"), tentative: fact("JFK") }, budgetCents: { tentative: fact(20_000) } }), { homeAirport: "EWR" });
});

test("profile boundaries reject addresses, credentials, raw schedules and invalid values", () => {
  for (const patch of [{ arrivalPreference: "pick me up at 123 Main Street" }, { homeCity: "One Main Street" }, { name: "api-key supersecret" },
    { arrivalPreference: "classes Monday at 10:00" }, { campusAddress: "123 Main Street" }, { ownerId: actor.userId }, { timeZone: "EST" },
    { timeZone: "Earth/Unknown" }, { budgetCents: 1.5 }, { homeAirport: "ewr" }, {}]) {
    assert.equal(profilePatchSchema.safeParse(patch).success, false);
  }
  assert.equal(profilePatchSchema.safeParse({ name: "Taylor", timeZone: "America/New_York", homeAirport: "EWR", arrivalPreference: "I like arriving before dinner with family" }).success, true);
});

test("trip references prioritize explicit names and clarify ambiguous references", () => {
  assert.equal(resolveTrip([home, boston], boston.id, "home").id, home.id);
  assert.equal(resolveTrip([home, boston], boston.id).id, boston.id);
  assert.equal(resolveTrip([home, boston], home.id, "bOsToN").id, boston.id);
  assert.throws(() => resolveTrip([home, boston], home.id, undefined, true), /Choose a specific trip/);
  assert.throws(() => resolveTrip([home, boston], null), /Choose a specific trip/);
  assert.throws(() => resolveTrip([home], null, "another-user-trip"), /Choose a specific trip/);
});

test("indexing accepts only permitted travel fields and excludes private payloads", () => {
  const document = { currentTravelFacts: { homeAirport: "EWR", arrivalPreference: "before dinner with family" }, tripId: null, version: 2 };
  assert.deepEqual(permittedMemory(JSON.stringify(document)), document);
  for (const currentTravelFacts of [{ address: "123 Main Street" }, { apiKey: "secret" }, { arrivalPreference: "my password is secret" }, { payment: "4242" }]) {
    assert.throws(() => permittedMemory(JSON.stringify({ ...document, currentTravelFacts })));
  }
  assert.equal(tripPatchSchema.safeParse({ pickupAddress: "123 Main Street" }).success, false);
});

test("invalid date updates, class permission and address consent never reach the API", async () => {
  let requests = 0;
  const client = createClient("https://example.supabase.co", "test-key", { global: { fetch: async () => { requests++; throw new Error("Unexpected API request"); } } });
  const store = createProfileStore(client);
  await assert.rejects(store.patch(actor, { returnDate: "2026-10-22" }, "confirmed", home), /Return date/);
  await assert.rejects(store.patch(actor, { allowMissedCommitments: true }, "confirmed", home), /Explicit permission/);
  await assert.rejects(store.patch({ ...actor, sourceText: "do not skip classes for this trip" }, { allowMissedCommitments: true }, "confirmed", home), /Explicit permission/);
  await assert.rejects(store.proposeAddress(actor, "campus", "123 Main Street"), /exact address/);
  await assert.rejects(store.confirmAddress({ ...actor, sourceText: "maybe" }, home.id), /Explicit address-saving consent/);
  await assert.rejects(store.pickupOverride(actor, home, "the library"), /current user message/);
  assert.equal(requests, 0);
});

test("model tools bind owner and provenance from the backend rather than arguments", async () => {
  let captured: unknown;
  const client = createClient("https://example.supabase.co", "test-key", {
    global: { fetch: async (_input, init) => { captured = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ facts: {}, version: 2 })); } },
  });
  const tools = createAgentTools(createProfileStore(client), actor);
  await tools.update_profile.execute!({ patch: { homeAirport: "EWR" }, status: "confirmed" }, { toolCallId: "test", messages: [], context: {} });
  assert.deepEqual(captured, { p_owner: actor.userId, p_source: actor.sourceMessageId, p_patch: { homeAirport: "EWR" }, p_status: "confirmed", p_trip: null, p_version: null });
});

test("the model cannot bypass an ambiguous reference by guessing a trip name", async () => {
  let requests = 0;
  const client = createClient("https://example.supabase.co", "test-key", { global: { fetch: async () => { requests++; throw new Error("Unexpected API request"); } } });
  const store = createProfileStore(client);
  store.state = async () => ({ profile: {}, version: 1, activeTripId: home.id, trips: [home, boston], savedAddressKinds: [], pendingAddress: null, memoryEvidence: {} });
  const tools = createAgentTools(store, { ...actor, sourceText: "For that trip, make the budget $150" });
  await assert.rejects(async () => tools.update_trip.execute!({ reference: "home", patch: { budgetCents: 15_000 }, status: "confirmed" }, { toolCallId: "test", messages: [], context: {} }), /Choose a specific trip/);
  assert.equal(requests, 0);
});
