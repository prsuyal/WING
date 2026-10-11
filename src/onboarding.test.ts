import test from "node:test";
import assert from "node:assert/strict";
import { nextOnboarding, welcome } from "./onboarding.ts";
import { findAirports, nearbyAirports, requestedNearby } from "./airports.ts";
import { planningSchema } from "./flights.ts";
import { createAgent } from "./agent.ts";
import { createHandler } from "./handler.ts";
import { createProfileStore, type Facts } from "./profile.ts";
import { createClient } from "@supabase/supabase-js";
import type { LanguageModel } from "ai";
import type { ScheduleServices } from "./schedule-tools.ts";
import type { Onboarding } from "./onboarding.ts";

test("onboarding introduces real search and asks Calendar immediately after origin without a timezone question", () => {
  assert.match(welcome, /real flights/);
  assert.match(welcome, /booking is simulated/);
  assert.equal((welcome.match(/\?/g) ?? []).length, 1);
  assert.equal(nextOnboarding({ departureAirport: "CLT" }, [], false), "calendar");
  assert.equal(nextOnboarding({ departureAirport: "CLT" }, ["calendar"], false), "homeAirport");
});
test("a saved cheapest preference advances onboarding without requiring a numeric budget", () => {
  assert.equal(nextOnboarding({ departureAirport: "CLT", homeAirport: "DFW", budgetCents: null }, ["calendar"], false), "baggage");
});
test("Dallas lookup and nearby comparisons stay in Dallas", () => {
  assert.deepEqual(findAirports("Dallas").map((airport) => airport.code), ["DFW", "DAL"]);
  assert.deepEqual(nearbyAirports("DAL"), ["DAL", "DFW"]);
  assert.equal(requestedNearby("DFW", "can u compare the prices of dfw and dal for oct 20th"), true);
  assert.equal(requestedNearby("DFW", "compare CLT to DFW"), false);
  assert.equal(requestedNearby("DFW", "compare JFK and EWR"), false);
});
test("unknown budget can be searched without an invented cap", () => {
  const values = planningSchema.parse({ departureAirport: "CLT", arrivalAirport: "DFW", outboundDate: "2026-12-14", returnDate: "2027-01-06", timeZone: "America/New_York" });
  assert.equal(values.budgetCents, null);
  assert.equal(values.budgetMeaning, "round_trip_airfare_per_person");
});

test("the production handler-to-agent welcome does not call Claude or memory", async () => {
  let facts: Facts = {}, onboarding: Onboarding | undefined;
  const store = createProfileStore(createClient("https://example.supabase.co", "unit-key"));
  store.state = async () => ({ profile: facts, version: 1, activeTripId: null, trips: [], savedAddressKinds: [], pendingAddress: null, memoryEvidence: {}, ...(onboarding ? { onboarding } : {}) });
  store.onboarding = async (_actor, value) => { onboarding = value; };
  store.patch = async (actor, patch) => { facts = Object.fromEntries(Object.entries(patch as Record<string, unknown>).map(([key, value]) => [key, { confirmed: { value, sourceMessageId: actor.sourceMessageId, updatedAt: new Date().toISOString() } }])); return { facts, version: 2 }; };
  const services = { calendar: { state: async () => ({ status: "disconnected" }) } } as unknown as ScheduleServices;
  const agent = createAgent({} as LanguageModel, store, services);
  const replies: string[] = [];
  const chat = { id: "dm", type: "dm" as const, responding: async <T>(run: () => Promise<T>) => run(), send: async (text: string) => { replies.push(text); } };
  const handle = createHandler(agent, { recall: async () => { assert.fail("Onboarding must not wait for memory"); }, remember: async () => {} }, "project");
  const actor = { userId: "00000000-0000-4000-8000-000000000001", sourceMessageId: "00000000-0000-4000-8000-000000000002", namespace: "wing_user_unit", sourceText: "hello" };
  const message = (id: string, text: string) => ({ id, direction: "inbound" as const, content: { type: "text" as const, text }, sender: { id: "unit", __platform: "imessage" } });
  await handle(chat, message("1", "hello"), actor);
  assert.equal(replies[0], welcome);
});

test("a complete saved profile doesn't leave empty onboarding active and overwrite later answers", async () => {
  const actor = { userId: "00000000-0000-4000-8000-000000000001", sourceMessageId: "00000000-0000-4000-8000-000000000002", namespace: "wing_user_unit", sourceText: "hello" };
  const facts = Object.fromEntries(Object.entries({ departureAirport: "CLT", homeAirport: "DFW", budgetCents: null, baggage: "carry_on", nonstop: false }).map(([key, value]) => [key, { confirmed: { value, sourceMessageId: actor.sourceMessageId, updatedAt: new Date().toISOString() } }]));
  let onboarding: Onboarding | undefined;
  const store = createProfileStore(createClient("https://example.supabase.co", "unit-key"));
  store.state = async () => ({ profile: facts, version: 1, activeTripId: null, trips: [], savedAddressKinds: [], pendingAddress: null, memoryEvidence: {} });
  store.onboarding = async (_actor, value) => { onboarding = value; };
  const services = { calendar: { state: async () => ({ status: "connected", selected: ["primary"] }) } } as unknown as ScheduleServices;
  const reply = await createAgent({} as LanguageModel, store, services)([{ role: "user", content: "hello" }], "", actor);
  assert.match(reply, /you're all set/);
  assert.equal(onboarding?.active, false);
});
