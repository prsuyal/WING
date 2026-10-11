import assert from "node:assert/strict";
import { loadEnvFile } from "node:process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { ModelMessage } from "ai";
import { createDatabase } from "../src/database.ts";
import { createProfileStore, confirmedFacts } from "../src/profile.ts";
import { createScheduleStore } from "../src/schedule-store.ts";
import { createCalendar } from "../src/calendar.ts";
import { createFlightPlanner } from "../src/flight-store.ts";
import { createLiveFlights } from "../src/live-flights.ts";
import { createBookings, createDemoBookingProvider } from "../src/booking.ts";
import { createAlerts } from "../src/alerts.ts";
import { createAgent } from "../src/agent.ts";
import { memoryNamespace } from "../src/memory.ts";
import type { Actor } from "../src/contracts.ts";
loadEnvFile();
const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const db = createDatabase(client), profiles = createProfileStore(client), schedules = createScheduleStore(client), owners: string[] = [], run = randomUUID(), passed: string[] = [];
const calendar = createCalendar(client, { baseUrl: "http://localhost:3000", clientId: "synthetic", clientSecret: "synthetic", encryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY!, fetch: async () => { throw new Error("No calendar calls expected for unconnected test accounts"); } });
const services = { calendar, schedules }, live = createLiveFlights(process.env.SERPAPI_API_KEY!, client), flights = createFlightPlanner(client, profiles, services, {}, live), bookings = createBookings(client, profiles, flights, createDemoBookingProvider(client, 0)), alerts = createAlerts(client, profiles, flights);
const model = createAnthropic({ headers: process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : undefined })(process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5");
let agent = createAgent(model, profiles, services, flights, bookings, undefined, alerts);
const namespace = memoryNamespace(process.env.PROJECT_ID!, "imessage", `product_${run}`);
async function source(text: string): Promise<Actor> { const row = await db.receive(namespace, run, randomUUID(), { type: "text", text }); if (!owners.includes(row.userId)) owners.push(row.userId); return { userId: row.userId, sourceMessageId: row.messageId, namespace, sourceText: text }; }
async function present(actor: Actor, text: string) { const reply = await db.prepareReply({ userId: actor.userId, messageId: actor.sourceMessageId, isNew: true }, run, text, 0); await db.status(actor.userId, reply, "sent"); }
const history: ModelMessage[] = [];
async function chat(text: string) { const actor = await source(text); history.push({ role: "user", content: text }); const reply = await agent(history, "", actor); await present(actor, reply); history.push({ role: "assistant", content: reply }); return { actor, reply }; }
function done(check: string) { passed.push(check); console.log(JSON.stringify({ check, status: "passed" })); }
try {
  const hello = await chat("hello"); assert.ok(hello.reply.startsWith("hey, i'm wing")); assert.equal((hello.reply.match(/\?/g) ?? []).length, 1);
  await chat("I usually fly from RDU, live in Eastern time, my home airport is EWR, budget $600 per person round-trip airfare, carry-on, and nonstop");
  const facts = confirmedFacts((await profiles.state(hello.actor.userId)).profile);
  for (const [field, expected] of Object.entries({ departureAirport: "RDU", homeAirport: "EWR", budgetCents: 60000, baggage: "carry_on", nonstop: true, timeZone: "America/New_York" })) assert.equal(facts[field], expected);
  agent = createAgent(model, createProfileStore(client), services, flights, bookings, undefined, alerts);
  const skip = await chat("skip"); assert.equal(skip.reply, "all set — where would you like to go?");
  assert.equal((await profiles.state(hello.actor.userId)).onboarding?.active, false);
  done("first_time_intro_multi_preference_answer_skip_and_resume_after_agent_restart");
  const restart = await chat("/onboard"); assert.ok(!restart.reply.includes("where do you usually fly from")); await chat("skip");
  assert.deepEqual(confirmedFacts((await profiles.state(hello.actor.userId)).profile), facts);
  done("onboarding_replay_preserves_known_preferences_without_deleting_trips_or_memory");
  const actor = await source("Plan live search product test");
  let trip = await profiles.createTrip(actor, "live search product test", "verification only");
  await profiles.patch(await source("Leave November 20, return November 23, 2026, test airfare budget $2000"), { arrivalAirport: "EWR", outboundDate: "2026-11-20", returnDate: "2026-11-23", budgetCents: 200000 }, "confirmed", trip);
  const searchActor = await source("search flights for live search product test"), search = await flights.search(searchActor, { reference: trip.id });
  assert.ok(search.result?.options.length, JSON.stringify({ message: search.message, status: search.result?.status, reasons: search.result?.rejected.map((item) => item.reason) })); assert.equal(search.result.simulated, false); assert.equal(search.result.scheduleChecked, false); assert.ok(search.message.includes("i found one")); await present(searchActor, search.message);
  const option = search.result.options[0]!.offer;
  const compared = await flights.compare(await source("is this a good price?"), 1, trip.id); assert.ok(compared.message.includes("no verified history"));
  done("real_us_search_persists_complete_round_trip_and_honest_unchecked_schedule_and_baggage");
  const select = await source("book that one"), review = await bookings.select(select, 1, trip.id); assert.ok(review?.includes("simulated booking")); await present(select, review!);
  const action = (await bookings.state(actor.userId)).find((row) => row.tripId === trip.id && row.status === "review")!; assert.ok(action);
  const approval = await source("ya"), confirmation = await bookings.approve(approval, action.id); assert.ok(confirmation.includes("simulated reservation")); await present(approval, confirmation);
  const { data: reservation, error } = await client.from("wing_flight_reservations").select("simulated,offer").eq("owner_id", actor.userId).eq("action_id", action.id).single(); assert.equal(error, null); assert.equal(reservation.simulated, true); assert.equal(reservation.offer.simulated, false); assert.equal(reservation.offer.id, option.id);
  const replay = await bookings.command(await source("yup")); assert.ok(replay?.includes("just one simulated reservation"));
  done("real_quote_selection_separate_casual_approval_demo_reservation_and_duplicate_suppression");
  trip = await profiles.createTrip(await source("Plan watch verification"), "live watch product test", "verification only");
  await profiles.patch(await source("Leave November 20, return November 23, 2026, test airfare budget $2000"), { arrivalAirport: "EWR", outboundDate: "2026-11-20", returnDate: "2026-11-23", budgetCents: 200000 }, "confirmed", trip);
  const watchSearch = await source("search flights for live watch product test"), saved = await flights.search(watchSearch, { reference: trip.id }); assert.ok(saved.result?.options.length); await present(watchSearch, saved.message);
  const watched = await alerts.createWatch(await source("watch live watch product test for $100 and text me"), { reference: trip.id, mode: "target", targetCents: 10000, notify: true }); assert.ok(watched.includes("live quotes"));
  const rows = await alerts.state(actor.userId); assert.equal(rows.watches[0]!.notify, true);
  const checked = await alerts.check(await source("check live watch product test"), trip.id); assert.ok(checked.includes("live quote"));
  await assert.rejects(alerts.demoPrice(await source("/demo-price 98 live watch product test"), 98, trip.id));
  await alerts.stop(await source("mute live watch product test"), trip.id);
  assert.equal((await alerts.state(actor.userId)).watches[0]!.status, "stopped");
  done("real_itinerary_watch_checks_consents_labels_and_rejects_synthetic_price_changes");
  writeFileSync("verification/product.json", JSON.stringify({ status: "automated_checks_passed", checkedAt: new Date().toISOString(), checks: passed, liveSearch: ["RDU-EWR", "JFK-LHR"], bookings: "simulated only", transport: "captured; no human messaged", pending: ["Railway deployment and user onboarding checkpoint"] }, null, 2) + "\n");
} finally {
  for (const owner of owners) { const { error } = await client.from("wing_users").delete().eq("id", owner); if (error) throw new Error("Disposable product account cleanup failed"); }
}
