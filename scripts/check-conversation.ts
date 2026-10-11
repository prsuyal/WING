import assert from "node:assert/strict";
import { loadEnvFile } from "node:process";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createClient } from "@supabase/supabase-js";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { ModelMessage } from "ai";
import { createDatabase } from "../src/database.ts";
import { createProfileStore, confirmedFacts } from "../src/profile.ts";
import { createCalendar } from "../src/calendar.ts";
import { createScheduleStore } from "../src/schedule-store.ts";
import { createFlightPlanner } from "../src/flight-store.ts";
import { createLiveFlights } from "../src/live-flights.ts";
import { createBookings, createDemoBookingProvider } from "../src/booking.ts";
import { createAgent } from "../src/agent.ts";
import { memoryNamespace } from "../src/memory.ts";
import type { Actor } from "../src/contracts.ts";
loadEnvFile();
const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const db = createDatabase(client), profiles = createProfileStore(client), schedules = createScheduleStore(client), owners: string[] = [];
const calendar = createCalendar(client, { baseUrl: process.env.PUBLIC_BASE_URL!, clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET!, encryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY!, fetch: async () => { throw new Error("Calendar authorization is not completed in this test"); } });
const services = { calendar, schedules }, flights = createFlightPlanner(client, profiles, services, {}, createLiveFlights(process.env.SERPAPI_API_KEY!, client));
const bookings = createBookings(client, profiles, flights, createDemoBookingProvider(client, 0));
const model = createAnthropic({ headers: process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : undefined })(process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5");
const agent = createAgent(model, profiles, services, flights, bookings);
function traveler(label: string) {
  const namespace = memoryNamespace(process.env.PROJECT_ID!, "imessage", `conversation_${label}_${randomUUID()}`), history: ModelMessage[] = [];
  let lastActor: Actor;
  return { history, get actor() { return lastActor; }, async chat(text: string) {
    const received = await db.receive(namespace, namespace, randomUUID(), { type: "text", text });
    if (!owners.includes(received.userId)) owners.push(received.userId);
    lastActor = { userId: received.userId, sourceMessageId: received.messageId, namespace, sourceText: text };
    history.push({ role: "user", content: text });
    const start = performance.now(), reply = await agent(history, "HISTORICAL ONLY: a previous test once suggested JFK or EWR and a $250 budget", lastActor);
    const id = await db.prepareReply(received, namespace, reply, 0); await db.status(received.userId, id, "sent");
    history.push({ role: "assistant", content: reply });
    console.log(JSON.stringify({ label, input: text, reply, elapsedMs: Math.round(performance.now() - start) }));
    return reply;
  } };
}
try {
  const setup = traveler("onboarding");
  assert.match(await setup.chat("sup"), /i'm wing/);
  const zoneReply = await setup.chat("clt"); assert.match(zoneReply, /connect Google Calendar/); assert.doesNotMatch(zoneReply, /time zone|eastern|est\?/i);
  assert.equal(confirmedFacts((await profiles.state(setup.actor.userId)).profile).timeZone, "America/New_York");
  const link = await setup.chat("ya"); assert.match(link, /https?:\/\//); assert.ok(link.length < 350);
  await setup.chat("Dallas");
  const dallasReply = await setup.chat("DFW"); assert.doesNotMatch(dallasReply, /JFK|EWR/); assert.match(dallasReply, /budget|cheapest/);
  const cheapReply = await setup.chat("just the cheapest flight"); assert.doesNotMatch(cheapReply, /budget|hard cap/); assert.match(cheapReply, /carry-on|bag/);
  const prefs = confirmedFacts((await profiles.state(setup.actor.userId)).profile); assert.equal(prefs.homeAirport, "DFW"); assert.equal(prefs.budgetCents, null); assert.equal(prefs.budgetMode, "cheapest");
  await setup.chat("carry on"); await setup.chat("layovers are fine");
  assert.equal((await profiles.state(setup.actor.userId)).onboarding?.active, false);
  const winter = await setup.chat("i'm going home for winter break, leave dec 14 and come back jan 6. find the cheapest flight");
  assert.doesNotMatch(winter, /is it 2026|which year|what year|JFK|EWR|what.*budget/i);
  const state = await profiles.state(setup.actor.userId), trip = state.trips.find((trip) => trip.id === state.activeTripId)!; assert.ok(trip);
  const facts = confirmedFacts(trip.facts); assert.equal(facts.outboundDate, "2026-12-14"); assert.equal(facts.returnDate, "2027-01-06"); assert.equal(facts.arrivalAirport, "DFW");
  const latest = await flights.latest(setup.actor); assert.ok(latest.result?.options.length, latest.message); assert.equal(latest.result.simulated, false); assert.equal(latest.result.options[0]!.offer.outbound[0]!.departureAirport, "CLT");
  console.log(JSON.stringify({ check: "onboarding_calendar_cheapest_airport_scope_upcoming_cross_year_real_search", status: "passed" }));
  const soft = traveler("rough_budget"); await soft.chat("hey"); await soft.chat("RDU"); await soft.chat("skip"); await soft.chat("EWR");
  const rough = await soft.chat("maybe 400ish"); assert.doesNotMatch(rough, /hard cap|budget/); const softPrefs = confirmedFacts((await profiles.state(soft.actor.userId)).profile); assert.equal(softPrefs.budgetCents, 40000); assert.equal(softPrefs.budgetMode, "target");
  console.log(JSON.stringify({ check: "rough_target_saved_once_without_reconfirmation", status: "passed" }));
  const direct = traveler("first_message_request");
  const reply = await direct.chat("Plan a new trip called direct Dallas: CLT to DFW, November 20–23, 2026. Just the cheapest flight, carry-on, nonstop. Search flights");
  assert.match(reply, /i'm wing/); assert.doesNotMatch(reply, /JFK|EWR|what.*budget|eastern|time zone/i); assert.match(reply, /connect Google Calendar/);
  const shown = await flights.latest(direct.actor); assert.ok(shown.result?.options.length, shown.message); assert.equal(shown.presentation, reply);
  const review = await direct.chat("book that one"); assert.match(review, /simulated booking/); assert.doesNotMatch(review, /show|display.*first/i);
  const booked = await direct.chat("ya"); assert.match(booked, /no real ticket or charge/); assert.match(booked, /add the flights to your calendar/); assert.doesNotMatch(booked, /ride/);
  console.log(JSON.stringify({ check: "first_message_request_preserved_calendar_nudge_delivery_bound_review_and_casual_approval", status: "passed" }));
} finally {
  for (const owner of owners) { const { error } = await client.from("wing_users").delete().eq("id", owner); if (error) throw new Error("Disposable conversation fixture cleanup failed"); }
}
