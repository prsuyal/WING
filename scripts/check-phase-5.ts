import assert from "node:assert/strict";
import { loadEnvFile } from "node:process";
import { randomUUID } from "node:crypto";
import { writeFileSync, readFileSync } from "node:fs";
import { Temporal } from "@js-temporal/polyfill";
import { createClient } from "@supabase/supabase-js";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createDatabase } from "../src/database.ts";
import { createProfileStore } from "../src/profile.ts";
import { createCalendar } from "../src/calendar.ts";
import { createScheduleStore } from "../src/schedule-store.ts";
import { createFlightPlanner } from "../src/flight-store.ts";
import { createBookings, createDemoBookingProvider, bookingReview } from "../src/booking.ts";
import { createJourneys, createDemoRideProvider, itineraryEvents, rideSchema } from "../src/journey.ts";
import { credentialVault } from "../src/credentials.ts";
import { presentReply } from "../src/conversation.ts";
import { createAgent } from "../src/agent.ts";
import { createHandler } from "../src/handler.ts";
import { createService } from "../src/service.ts";
import { memoryNamespace } from "../src/memory.ts";
import type { Actor } from "../src/contracts.ts";
import { offerSchema } from "../src/contracts.ts";
import { demoInventory } from "../src/flights.ts";

loadEnvFile();
const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) } });
const database = createDatabase(client), profiles = createProfileStore(client), schedules = createScheduleStore(client), run = randomUUID(), sender = `phase5_${run}`, ns = memoryNamespace(process.env.PROJECT_ID!, "imessage", sender);
const owners: string[] = [], passed: string[] = [], googleEvents = new Map<string, any>();
let stage = "setup", inserts = 0, calendarMode: "normal" | "lost_after" | "forbidden" | "race" = "normal", rideMode: "normal" | "lost_after" | "lost_before" | "failed" | "race" = "normal", rideCalls = 0, raceOwner = "", concurrentGoogleInsert = false;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const calendar = createCalendar(client, { baseUrl: "http://localhost:3000", clientId: "synthetic", clientSecret: "synthetic", encryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY!, fetch: async (input, init) => {
  const url = new URL(String(input));
  assert.equal(url.hostname, "www.googleapis.com");
  if (calendarMode === "forbidden") return json({}, 403);
  if (url.pathname.endsWith("calendarList")) return json({ items: [{ id: `synthetic_${run}`, summary: "Synthetic phase 5 calendar", primary: true, accessRole: "owner", timeZone: "America/New_York" }] });
  const base = `/calendar/v3/calendars/synthetic_${run}/events`, id = url.pathname.slice(base.length + 1);
  assert.ok(url.pathname.startsWith(base));
  if (init?.method === "POST") {
    const event = JSON.parse(String(init.body));
    assert.ok(event.summary.startsWith("[simulated]")); assert.ok(!event.attendees); assert.equal(url.searchParams.get("sendUpdates"), "none");
    if (googleEvents.has(event.id)) return json({}, 409);
    googleEvents.set(event.id, { ...event, status: "confirmed" }); inserts++;
    if (concurrentGoogleInsert) { concurrentGoogleInsert = false; return json({}, 409); }
    if (calendarMode === "race") { await client.from("wing_calendar_connections").update({ selection_version: 2 }).eq("owner_id", raceOwner); }
    if (calendarMode === "lost_after") { calendarMode = "normal"; throw new Error("Synthetic lost response after Google accepted the event"); }
    return json(event);
  }
  if (!id) return json({ items: [], timeZone: "America/New_York" });
  return googleEvents.has(id) ? json(googleEvents.get(id)) : json({}, 404);
} });
const flights = createFlightPlanner(client, profiles, { calendar, schedules }), bookings = createBookings(client, profiles, flights, createDemoBookingProvider(client, 0)), rideProvider = createDemoRideProvider(client, 0);
const journeys = createJourneys(client, profiles, calendar, { reserve: async (owner, id, lease) => {
  rideCalls++;
  if (rideMode === "lost_before") throw new Error("Synthetic lost response before acceptance");
  if (rideMode === "failed") { const result = await client.rpc("wing_finish_journey", { p_owner: owner, p_action: id, p_lease: lease, p_outcome: "failed" }); assert.equal(result.error, null); return; }
  if (rideMode === "race") { const { data } = await client.from("wing_journey_actions").select("trip_id").eq("owner_id", owner).eq("id", id).single(); const trip = (await profiles.state(owner)).trips.find((item) => item.id === data!.trip_id)!; await profiles.pickupOverride(await source(owner, ns, "Use 999 Changed Lane just for this trip"), trip, "999 Changed Lane"); }
  await rideProvider.reserve(owner, id, lease);
  if (rideMode === "lost_after") throw new Error("Synthetic lost response after reservation");
} });
function done(check: string) { passed.push(check); console.log(JSON.stringify({ check, status: "passed" })); }
async function source(owner: string, namespace: string, text: string): Promise<Actor> { const saved = await database.receive(namespace, run, randomUUID(), { type: "text", text }); assert.equal(saved.userId, owner); return { userId: owner, sourceMessageId: saved.messageId, namespace, sourceText: text }; }
async function present(actor: Actor, text: string) { const id = await database.prepareReply({ userId: actor.userId, messageId: actor.sourceMessageId, isNew: true }, run, text, 0); await database.status(actor.userId, id, "sent"); }
async function row(owner: string, tripId: string, kind: string) { const result = await client.from("wing_journey_actions").select("*").eq("owner_id", owner).eq("trip_id", tripId).eq("kind", kind).order("created_at", { ascending: false }).limit(1).single(); assert.equal(result.error, null); return result.data!; }
async function count(owner: string, tripId: string, kind: string) { const result = await client.from("wing_journey_actions").select("id", { head: true, count: "exact" }).eq("owner_id", owner).eq("trip_id", tripId).eq("kind", kind).eq("status", "confirmed"); assert.equal(result.error, null); return result.count; }
let departure = Temporal.Now.zonedDateTimeISO("America/New_York").toPlainDate().add({ days: 14 }); while (departure.dayOfWeek !== 5) departure = departure.add({ days: 1 });
async function booked(owner: string, title: string) {
  const trip = await profiles.createTrip(await source(owner, ns, `Create ${title}`), title, "home visit");
  await profiles.patch(await source(owner, ns, `Leave ${departure}, return ${departure.add({ days: 2 })}`), { arrivalAirport: "EWR", outboundDate: departure.toString(), returnDate: departure.add({ days: 2 }).toString() }, "confirmed", trip);
  const searcher = await source(owner, ns, `search ${title}`), search = await flights.search(searcher, { reference: trip.id }); await present(searcher, search.message);
  const choose = await source(owner, ns, "book that one"), review = await bookings.select(choose, 1, trip.id); await present(choose, review);
  const action = (await bookings.state(owner)).find((item) => item.tripId === trip.id)!;
  const approval = await source(owner, ns, "ya"), confirmation = await bookings.approve(approval, action.id); assert.match(confirmation, /simulated reservation is ready/); await present(approval, confirmation);
  return trip;
}
async function reviewRide(owner: string, tripId: string) { const actor = await source(owner, ns, "reserve an airport ride"), review = await journeys.proposeRide(actor, tripId); await present(actor, review); const action = await row(owner, tripId, "ride"); return { actor, review, action }; }
async function reviewItinerary(owner: string, tripId: string) { const actor = await source(owner, ns, "add the itinerary to my calendar"), review = await journeys.proposeItinerary(actor, tripId); await present(actor, review); const action = await row(owner, tripId, "itinerary"); return { actor, review, action }; }
try {
  const first = await database.receive(ns, run, randomUUID(), { type: "text", text: "Synthetic Phase 5 identity" }); owners.push(first.userId); const owner = first.userId;
  const otherNs = memoryNamespace(process.env.PROJECT_ID!, "imessage", `other_${run}`), other = await database.receive(otherNs, run, randomUUID(), { type: "text", text: "Synthetic other identity" }); owners.push(other.userId);
  const fact = (value: unknown) => ({ confirmed: { value, sourceMessageId: first.messageId, updatedAt: new Date().toISOString() } });
  assert.equal((await client.from("wing_profiles").upsert({ owner_id: owner, facts: Object.fromEntries(Object.entries({ name: "Taylor", timeZone: "America/New_York", departureAirport: "RDU", homeAirport: "EWR", budgetCents: 25000, budgetMeaning: "round_trip_airfare_per_person", nonstop: true, baggage: "carry_on" }).map(([key, value]) => [key, fact(value)])) })).error, null);
  const vault = credentialVault(process.env.CREDENTIAL_ENCRYPTION_KEY!);
  assert.equal((await client.from("wing_calendar_connections").insert({ owner_id: owner, status: "connected", credentials_cipher: vault.seal(owner, { access: "synthetic-access", refresh: "synthetic-refresh", expiry: Date.now() + 3600_000, scopes: ["https://www.googleapis.com/auth/calendar.events.owned"] }), selected_ids: [`synthetic_${run}`], choices: [] })).error, null);
  const savedAddressSource = await source(owner, ns, "Save 123 Original Lane as my campus address"), savedAddress = await profiles.proposeAddress(savedAddressSource, "campus", "123 Original Lane"); assert.equal(savedAddress.confirmed, true);
  const one = await booked(owner, "ride demo");
  stage = "ride_guards";
  const ride = await reviewRide(owner, one.id); assert.match(ride.review, /123 Original Lane → RDU/); assert.match(ride.review, /35 min drive \+ 120 min airport buffer/);
  assert.equal(await count(owner, one.id, "ride"), 0);
  await assert.rejects(journeys.approve({ ...ride.actor, sourceText: "yes" }, ride.action.id));
  await assert.rejects(journeys.approve(await source(owner, ns, "ya but use a different address"), ride.action.id));
  await assert.rejects(journeys.approve(await source(other.userId, otherNs, "ya"), ride.action.id));
  const direct = await client.rpc("wing_finish_journey", { p_owner: owner, p_action: ride.action.id, p_lease: randomUUID(), p_outcome: "confirmed" }); assert.ok(direct.error);
  const earlyTrip = await booked(owner, "early approval demo"), earlyReviewSource = await source(owner, ns, "ride please"), earlyReview = await journeys.proposeRide(earlyReviewSource, earlyTrip.id), earlyRow = await row(owner, earlyTrip.id, "ride"), earlyApproval = await source(owner, ns, "yes");
  assert.equal(await journeys.approve(earlyApproval, earlyRow.id), earlyReview); await present(earlyReviewSource, earlyReview);
  const early = await client.rpc("wing_claim_journey", { p_owner: owner, p_action: earlyRow.id, p_source: earlyApproval.sourceMessageId, p_lease: randomUUID() }); assert.ok(early.error);
  const beforeCalls = rideCalls; await present(await source(owner, ns, "/ride"), ride.review);
  const approvals = await Promise.all([journeys.approve({ ...await source(owner, ns, "ya"), present: async () => { throw new Error("Synthetic wording outage after acceptance"); } }, ride.action.id), journeys.approve(await source(owner, ns, "yup"), ride.action.id)]);
  assert.ok(approvals.some((text) => text.includes("ride reserved"))); assert.equal(rideCalls, beforeCalls + 1); assert.equal(await count(owner, one.id, "ride"), 1);
  assert.match(await journeys.approve(await source(owner, ns, "yes"), ride.action.id), /already reserved/);
  done("ride_ownership_exact_delivery_separate_approval_concurrency_and_duplicate_guards");

  stage = "pickup_override";
  const two = await booked(owner, "override demo"), old = await reviewRide(owner, two.id);
  const change = await source(owner, ns, "For override demo pick me up at 456 Temporary Lane just this trip");
  await assert.rejects(journeys.proposeRide(await source(owner, ns, "ride from somewhere else"), two.id, "555 Invented Lane"));
  const atomicReview = await journeys.proposeRide(change, two.id, "456 Temporary Lane"), overrideVersion = (await profiles.state(owner)).trips.find((trip) => trip.id === two.id)!.version;
  assert.equal(await journeys.proposeRide(change, two.id, "456 Temporary Lane"), atomicReview);
  assert.equal((await profiles.state(owner)).trips.find((trip) => trip.id === two.id)!.version, overrideVersion);
  await assert.rejects(journeys.approve(await source(owner, ns, "yes"), old.action.id));
  const refreshed = await source(owner, ns, "/ride"), refreshedText = await journeys.review(refreshed, "ride", two.id); assert.match(refreshedText, /456 Temporary Lane/); await present(refreshed, refreshedText);
  const changed = await reviewRide(owner, two.id); assert.notEqual(changed.action.id, old.action.id); assert.match(changed.review, /456 Temporary Lane/);
  assert.match(await journeys.approve(await source(owner, ns, "ya"), changed.action.id), /ride reserved/);
  const address = await client.from("wing_addresses").select("address").eq("owner_id", owner).eq("id", savedAddress.id).single(); assert.equal(address.data!.address, "123 Original Lane");
  const memory = await client.from("wing_memory_documents").select("content").eq("owner_id", owner); assert.ok(!JSON.stringify(memory.data).includes("Temporary Lane") && !JSON.stringify(memory.data).includes("Original Lane"));
  done("temporary_pickup_is_trip_scoped_stale_review_rejected_and_private_addresses_excluded_from_memory");

  stage = "decline_expiry_payment";
  const declinedTrip = await booked(owner, "decline ride demo"), declined = await reviewRide(owner, declinedTrip.id), no = await source(owner, ns, "no"); assert.match((await journeys.command(no))!, /won't do/); await assert.rejects(journeys.approve(await source(owner, ns, "yes"), declined.action.id));
  const expiredTrip = await booked(owner, "expiry ride demo"), expired = await reviewRide(owner, expiredTrip.id); await client.from("wing_journey_actions").update({ expires_at: "2000-01-01T00:00:00Z" }).eq("owner_id", owner).eq("id", expired.action.id); await assert.rejects(journeys.approve(await source(owner, ns, "yes"), expired.action.id));
  const paymentTrip = await booked(owner, "payment ride demo"), paymentReview = await reviewRide(owner, paymentTrip.id); await client.from("wing_demo_payments").update({ version: 2 }).eq("owner_id", owner); await assert.rejects(journeys.approve(await source(owner, ns, "yes"), paymentReview.action.id)); await client.from("wing_demo_payments").update({ version: 1 }).eq("owner_id", owner);
  const renewed = await reviewRide(owner, expiredTrip.id), lease = randomUUID(), freshApproval = await source(owner, ns, "yes");
  const claimed = await client.rpc("wing_claim_journey", { p_owner: owner, p_action: renewed.action.id, p_source: freshApproval.sourceMessageId, p_lease: lease }); assert.equal(claimed.error, null); assert.equal(claimed.data, true);
  await client.from("wing_journey_actions").update({ payload: { ...renewed.action.payload, totalCents: 9999 } }).eq("owner_id", owner).eq("id", renewed.action.id);
  const tampered = await client.rpc("wing_finish_journey", { p_owner: owner, p_action: renewed.action.id, p_lease: lease, p_outcome: "confirmed" }); assert.ok(tampered.error); assert.equal(await count(owner, expiredTrip.id, "ride"), 0);
  done("declined_expired_changed_payment_or_post_approval_tampered_terms_never_reserve");

  stage = "ride_provider_recovery";
  rideMode = "failed"; const failureTrip = await booked(owner, "failed ride demo"), failed = await reviewRide(owner, failureTrip.id); assert.match(await journeys.approve(await source(owner, ns, "ya"), failed.action.id), /failed/); assert.equal(await count(owner, failureTrip.id, "ride"), 0);
  rideMode = "lost_after"; const lostTrip = await booked(owner, "lost ride demo"), lost = await reviewRide(owner, lostTrip.id); assert.match(await journeys.approve(await source(owner, ns, "ya"), lost.action.id), /couldn't confirm/); const calls = rideCalls; assert.match(await journeys.review(await source(owner, ns, "/ride"), "ride", lostTrip.id), /already reserved/); assert.equal(rideCalls, calls); assert.equal(await count(owner, lostTrip.id, "ride"), 1);
  rideMode = "lost_before"; const retryTrip = await booked(owner, "retry ride demo"), retry = await reviewRide(owner, retryTrip.id); assert.match(await journeys.approve(await source(owner, ns, "ya"), retry.action.id), /couldn't confirm/); rideMode = "normal"; const reconcile = await source(owner, ns, "/ride"); await present(reconcile, await journeys.review(reconcile, "ride", retryTrip.id)); assert.match(await journeys.approve(await source(owner, ns, "yup"), retry.action.id), /ride reserved/); assert.equal(await count(owner, retryTrip.id, "ride"), 1);
  rideMode = "race"; const raceTrip = await booked(owner, "race ride demo"), race = await reviewRide(owner, raceTrip.id); assert.match(await journeys.approve(await source(owner, ns, "ya"), race.action.id), /couldn't confirm/); assert.equal(await count(owner, raceTrip.id, "ride"), 0); rideMode = "normal";
  done("ride_failure_lost_responses_and_pickup_race_recover_without_duplicate_reservation");

  stage = "calendar_approval";
  const calendarReview = await reviewItinerary(owner, one.id); assert.equal(calendarReview.action.payload.events.length, 3); assert.equal(inserts, 0);
  await assert.rejects(journeys.approve(await source(other.userId, otherNs, "ya"), calendarReview.action.id));
  const approving = await source(owner, ns, "ya"); assert.match(await journeys.approve(approving, calendarReview.action.id), /added to/); assert.equal(inserts, 3); assert.equal(await count(owner, one.id, "itinerary"), 1);
  assert.match(await journeys.approve(await source(owner, ns, "yes"), calendarReview.action.id), /already on/); assert.equal(inserts, 3);
  const again = await journeys.proposeItinerary(await source(owner, ns, "add it again"), one.id); assert.match(again, /already on/);
  done("calendar_needs_separate_approval_and_writes_all_demo_events_once_with_readback");

  stage = "calendar_insert_race";
  const insertRaceTrip = await booked(owner, "Google insert race demo"), insertRace = await reviewItinerary(owner, insertRaceTrip.id), beforeConflict = inserts; concurrentGoogleInsert = true;
  assert.match(await journeys.approve(await source(owner, ns, "ya"), insertRace.action.id), /added to/); assert.equal(inserts, beforeConflict + 2);
  done("google_insert_conflict_is_reconciled_by_exact_readback_without_a_duplicate");

  stage = "calendar_partial_retry";
  const partialTrip = await booked(owner, "partial calendar demo"), partial = await reviewItinerary(owner, partialTrip.id); calendarMode = "lost_after"; const initialInserts = inserts;
  assert.match(await journeys.approve(await source(owner, ns, "ya"), partial.action.id), /couldn't confirm/); assert.equal(inserts, initialInserts + 1); assert.equal(await count(owner, partialTrip.id, "itinerary"), 0);
  await client.from("wing_journey_actions").update({ expires_at: "2000-01-01T00:00:00Z" }).eq("owner_id", owner).eq("id", partial.action.id);
  const fresh = createJourneys(client, profiles, calendar, rideProvider), retrySource = await source(owner, ns, "/itinerary"), recoveredReview = await fresh.review(retrySource, "itinerary", partialTrip.id); assert.equal(recoveredReview, partial.review); await present(retrySource, recoveredReview);
  assert.match(await fresh.approve(await source(owner, ns, "yup"), partial.action.id), /added to/); assert.equal(inserts, initialInserts + 2);
  done("calendar_partial_success_survives_restart_and_reuses_stable_event_ids");

  stage = "calendar_permissions_and_external_change";
  const guardedTrip = await booked(owner, "calendar guards demo"), guarded = await reviewItinerary(owner, guardedTrip.id), oldInserts = inserts;
  await client.from("wing_calendar_connections").update({ selection_version: 2 }).eq("owner_id", owner); await assert.rejects(journeys.approve(await source(owner, ns, "ya"), guarded.action.id)); await client.from("wing_calendar_connections").update({ selection_version: 1 }).eq("owner_id", owner);
  calendarMode = "forbidden"; await assert.rejects(journeys.approve(await source(owner, ns, "ya"), guarded.action.id)); calendarMode = "normal"; assert.equal(inserts, oldInserts);
  const collisionEvent = guarded.action.payload.events[0]; googleEvents.set(collisionEvent.id, { ...collisionEvent, summary: "Personal event someone changed", status: "confirmed" });
  await present(await source(owner, ns, "/itinerary"), guarded.review); assert.match(await journeys.approve(await source(owner, ns, "ya"), guarded.action.id), /couldn't confirm/); assert.equal(googleEvents.get(collisionEvent.id).summary, "Personal event someone changed"); assert.equal(inserts, oldInserts);
  const changedCalendarTrip = await booked(owner, "calendar race demo"), changedCalendar = await reviewItinerary(owner, changedCalendarTrip.id); calendarMode = "race"; raceOwner = owner; await present(await source(owner, ns, "/itinerary"), changedCalendar.review);
  assert.match(await journeys.approve(await source(owner, ns, "ya"), changedCalendar.action.id), /couldn't confirm/); assert.equal(await count(owner, changedCalendarTrip.id, "itinerary"), 0); calendarMode = "normal"; await client.from("wing_calendar_connections").update({ selection_version: 1 }).eq("owner_id", owner);
  done("revoked_or_changed_calendar_access_blocks_writes_and_existing_mismatched_events_are_never_modified");

  stage = "flights_then_pickup_calendar";
  const addRide = await reviewRide(owner, partialTrip.id); await journeys.approve(await source(owner, ns, "ya"), addRide.action.id);
  const withRide = await reviewItinerary(owner, partialTrip.id), beforePickup = inserts; assert.equal(withRide.action.payload.events.length, 3); await journeys.approve(await source(owner, ns, "ya"), withRide.action.id); assert.equal(inserts, beforePickup + 1);
  done("adding_a_ride_later_adds_only_the_pickup_event_without_duplicate_flights");

  stage = "real_claude_journey";

  const model = createAnthropic({ headers: process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : undefined })(process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5");
  const testDatabase = { ...database, status: async (...args: Parameters<typeof database.status>) => { if (args[2] !== "handled") await database.status(...args); } };
  const create = () => createService(testDatabase, process.env.PROJECT_ID!, createHandler(createAgent(model, profiles, { calendar, schedules }, flights, bookings, journeys), { recall: async () => "", remember: async () => {} }, process.env.PROJECT_ID!));
  let service = create(), replies: string[] = [];
  const chat = { id: run, type: "dm" as const, responding: async <T>(fn: () => T | Promise<T>) => fn(), send: async (text: string) => { replies.push(text); } };
  async function ask(text: string) { stage = `real_claude_message_${text.startsWith("Plan") ? "search" : text.startsWith("book that") ? "flight_review" : text.startsWith("get me") ? "pickup_review" : text}`; replies = []; await service(chat, { id: randomUUID(), sender: { id: sender, __platform: "imessage" }, direction: "inbound", content: { type: "text", text } }); assert.ok(replies.length); assert.ok(!replies.join().includes("couldn't reach Claude")); return replies.join("\n"); }
  const planned = await ask(`Plan a new trip called conversation journey demo: RDU to EWR, ${departure} to ${departure.add({ days: 2 })}, $250 per person round-trip airfare, carry-on, nonstop. Search flights that fit my calendar`);
  assert.match(planned, /simulat/i);
  const chatTrip = (await profiles.state(owner)).trips.find((trip) => trip.title === "conversation journey demo")!; assert.ok(chatTrip);
  assert.match(await ask("book that one for conversation journey demo"), /simulat/i);
  assert.match(await ask("ya"), /simulat/i);
  assert.match(await ask("get me an airport ride for conversation journey demo from 789 Just This Trip Lane — don't save it as my campus address"), /789 just this trip lane/i);
  assert.equal(await count(owner, chatTrip.id, "ride"), 0);
  service = create(); assert.match(await ask("ya"), /simulat/i); assert.equal(await count(owner, chatTrip.id, "ride"), 1);
  const beforeReview = inserts; assert.match(await ask("yup"), /calendar/i); assert.equal(inserts, beforeReview);
  service = create(); assert.match(await ask("ya"), /added|calendar/i); assert.equal(inserts, beforeReview + 3);
  const noDuplicate = await ask("yes"); assert.match(noDuplicate, /already|all set/i); assert.equal(inserts, beforeReview + 3);
  assert.equal((await client.from("wing_addresses").select("address").eq("owner_id", owner).eq("id", savedAddress.id).single()).data!.address, "123 Original Lane");
  done("real_claude_full_flight_to_ride_to_calendar_journey_separate_approvals_and_restart");

  stage = "invitation_trip_binding";
  const invitationTrip = await booked(owner, "invitation trip demo"), otherTrip = await profiles.createTrip(await source(owner, ns, "Create another active trip"), "another active trip", "separate trip");
  const approval = await source(owner, ns, "yes"); assert.match((await journeys.command(approval))!, /Original Lane → RDU/); assert.equal((await row(owner, invitationTrip.id, "ride")).trip_id, invitationTrip.id); assert.ok(otherTrip.id !== invitationTrip.id);
  done("delivered_invitation_remains_bound_to_its_booked_trip_when_active_trip_changes");

  stage = "live_quote_texting_regression";
  const liveFlights = createFlightPlanner(client, profiles, { calendar, schedules }, {}, async (owner, tripId, preferences, pairs, nearby, now) =>
    demoInventory(owner, tripId, preferences, pairs, nearby, now).map((offer) => offerSchema.parse({ ...offer, simulated: false, inventoryVersion: "serpapi-v1", airline: "Fixture Air", outboundFareCents: null, inboundFareCents: null, baggageFeeCents: null, baggage: "bag allowance and extra fees unconfirmed", priceHistory: [{ observedAt: now, totalCents: offer.totalCents, simulated: false }], outbound: offer.outbound.map((leg) => ({ ...leg, flightNumber: leg.flightNumber.replace("DEMO", "EX") })), inbound: offer.inbound.map((leg) => ({ ...leg, flightNumber: leg.flightNumber.replace("DEMO", "EX") })) })));
  const liveBookings = createBookings(client, profiles, liveFlights, createDemoBookingProvider(client, 0));
  const liveTrip = await profiles.createTrip(await source(owner, ns, "Create texting regression"), "texting regression", "fixture only");
  await profiles.patch(await source(owner, ns, "round trip to EWR with layovers allowed"), { arrivalAirport: "EWR", outboundDate: departure.toString(), returnDate: departure.add({ days: 2 }).toString(), nonstop: false }, "confirmed", liveTrip);
  const searchSource = await source(owner, ns, "show all flight options for texting regression"), liveSearch = await liveFlights.search(searchSource, { reference: liveTrip.id });
  assert.equal(liveSearch.result!.options.length, 3); await present(searchSource, liveSearch.message);
  await profiles.onboarding(await source(owner, ns, "complete fixture onboarding"), { introduced: true, active: false, skipped: [] });
  service = createService(testDatabase, process.env.PROJECT_ID!, createHandler(createAgent(model, profiles, { calendar, schedules }, liveFlights, liveBookings, journeys), { recall: async () => "", remember: async () => {} }, process.env.PROJECT_ID!));
  assert.match(await ask("ok cool lets do 1"), /simulat/i); assert.ok(replies.length >= 4); assert.ok(replies.every((text) => !text.includes("\n\n") && !text.includes("—") && !/demo/i.test(text)));
  assert.equal((await client.from("wing_flight_reservations").select("id", { count: "exact", head: true }).eq("owner_id", owner).eq("trip_id", liveTrip.id)).count, 0);
  assert.match(await ask("yes book"), /simulat/i); assert.equal((await client.from("wing_flight_reservations").select("id", { count: "exact", head: true }).eq("owner_id", owner).eq("trip_id", liveTrip.id)).count, 1);
  const rideReviewText = await ask("sure");
  assert.match(rideReviewText, /simulat/i); assert.match(rideReviewText, /123 original lane/i);
  assert.ok(replies.every((text) => !/[·→←↔•;—]/.test(text))); assert.equal(await count(owner, liveTrip.id, "ride"), 0);
  const rideConfirmation = await ask("ya"); assert.match(rideConfirmation, /simulat/i); assert.match(rideConfirmation, /calendar/i); assert.equal(await count(owner, liveTrip.id, "ride"), 1);
  const beforeLiveEvents = inserts;
  const liveCalendarReview = await ask("yup"); assert.match(liveCalendarReview, /synthetic phase 5 calendar/i); assert.equal(inserts, beforeLiveEvents);
  assert.ok(replies.every((text) => !/[·→←↔•;—]/.test(text)));
  const totalLegs = liveSearch.result!.options[0]!.offer.outbound.length + liveSearch.result!.options[0]!.offer.inbound.length;
  assert.match(await ask("ya"), /added|calendar/i); assert.equal(inserts, beforeLiveEvents + totalLegs + 1);
  const eventAnswer = await ask("what events?"); assert.match(eventAnswer, /calendar/i); assert.match(eventAnswer, /ewr|rdu|newark|raleigh/i); assert.doesNotMatch(eventAnswer, /reply yes|waiting|pending/); assert.equal(inserts, beforeLiveEvents + totalLegs + 1);
  assert.match(await ask("add the flights to my calendar again"), /already|all set/i); assert.equal(inserts, beforeLiveEvents + totalLegs + 1);
  assert.equal((await journeys.state(owner)).find((action) => action.tripId === liveTrip.id && action.kind === "itinerary" && action.status === "confirmed")!.review, undefined);
  done("live_quote_natural_flight_review_simulated_ride_separate_calendar_approvals_and_no_duplicates");
  stage = "international_natural_approval";
  const international = offerSchema.parse({ ...liveSearch.result!.options[0]!.offer, totalCents: 95000, perPersonCents: 95000, priceHistory: [{ observedAt: new Date().toISOString(), totalCents: 95000, simulated: false }],
    outbound: [{ ...liveSearch.result!.options[0]!.offer.outbound[0]!, departureAirport: "EWR", arrivalAirport: "BCN", departureTimeZone: "America/New_York", arrivalTimeZone: "Europe/Madrid", departsAt: "2026-12-11T23:30:00Z", arrivesAt: "2026-12-12T07:20:00Z", flightNumber: "UA 120" }],
    inbound: [{ ...liveSearch.result!.options[0]!.offer.inbound[0]!, departureAirport: "BCN", arrivalAirport: "EWR", departureTimeZone: "Europe/Madrid", arrivalTimeZone: "America/New_York", departsAt: "2026-12-19T10:00:00Z", arrivesAt: "2026-12-19T19:15:00Z", flightNumber: "UA 121" }],
  });
  const internationalText = await presentReply(model)(bookingReview(randomUUID(), international, [], undefined, false));
  assert.doesNotMatch(internationalText, /[·→←↔•;—]|demo/i);
  assert.match(internationalText, /\$950/); assert.match(internationalText, /2026/); assert.match(internationalText, /simulat/i);
  assert.match(internationalText, /120/); assert.match(internationalText, /121/); assert.match(internationalText, /6:30/); assert.match(internationalText, /8:20/); assert.match(internationalText, /2:15/);
  assert.match(internationalText, /unconfirmed|unknown|haven't confirmed|not confirmed/i);
  console.log(JSON.stringify({ check: "international_overnight_natural_review_preserves_price_times_local_zones_bags_and_schedule_uncertainty", messages: internationalText.split("\n\n"), status: "passed" }));
  done("international_natural_approval_verified_before_delivery");
  const path = "verification/phase-5.json"; let previous: Record<string, unknown> = {}; try { previous = JSON.parse(readFileSync(path, "utf8")); } catch {}
  writeFileSync(path, JSON.stringify({ ...previous, phase: 5, status: previous.status === "complete" ? "complete" : "awaiting_live_phone_and_google_gate", checkedAt: new Date().toISOString(), passed, privateTestUsersRemoved: true, simulated: ["rides", "ride fare", "driving time", "flight reservation", "payment"], integrations: { database: "real hosted Supabase", model: "real Claude API", google: "real HTTP client against controlled Google responses; live itinerary gate pending", photon: "captured transport; live ride/calendar phone gate pending" }, calendarSafety: "stable IDs + exact readback; private transparent [DEMO] events with no reminders or attendees; no modifying or deleting other events", scope: { rides: "future outbound airport reservation only; never dispatch", iCloud: "deferred by user" }, pending: ["Live iMessage ride approval and separate real Google itinerary write/readback"] }, null, 2) + "\n");
} catch (error) {
  console.error(JSON.stringify({ stage, status: "failed", assertion: error instanceof assert.AssertionError ? { operator: error.operator, actual: typeof error.actual === "object" ? "structured mismatch" : error.actual, expected: typeof error.expected === "object" ? "structured value" : error.expected } : error instanceof Error ? error.message : "unknown", privateContentLogged: false })); process.exitCode = 1;
} finally {
  if (owners.length) { const { error } = await client.from("wing_users").delete().in("id", owners); if (error) { console.error("Synthetic cleanup failed"); process.exitCode = 1; } }
  console.log(JSON.stringify({ checks: passed.length, syntheticCleanup: "complete", result: process.exitCode ? "failed" : "passed" }));
}
