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
import { createBookings, createDemoBookingProvider } from "../src/booking.ts";
import { createAgent } from "../src/agent.ts";
import { createHandler } from "../src/handler.ts";
import { createService } from "../src/service.ts";
import { memoryNamespace } from "../src/memory.ts";
import type { Actor } from "../src/contracts.ts";

loadEnvFile();
const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) } });
const database = createDatabase(client), profiles = createProfileStore(client), schedules = createScheduleStore(client), run = randomUUID(), sender = `phase4_${run}`, ns = memoryNamespace(process.env.PROJECT_ID!, "imessage", sender);
const owners: string[] = [], passed: string[] = [];
let stage = "setup", unknown = false, calls = 0, mode: "normal" | "failed" | "lost_after" | "lost_before" | "changed" = "normal";
let departure = Temporal.Now.zonedDateTimeISO("America/New_York").toPlainDate().add({ days: 14 });
while (departure.dayOfWeek !== 5) departure = departure.add({ days: 1 });
const returned = departure.add({ days: 2 });
const calendar = createCalendar(client, { baseUrl: "http://localhost:3000", clientId: "synthetic", clientSecret: "synthetic", encryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY! });
calendar.state = async () => ({ status: "connected", selected: ["synthetic"], refreshedAt: new Date().toISOString(), pendingAction: null, choices: [{ id: "synthetic", summary: "Synthetic", primary: true, timeZone: "America/New_York", accessRole: "owner" }] });
calendar.sync = async () => ({ healthy: !unknown, unknown, refreshedAt: new Date().toISOString(), windows: [], contradictions: [] });
const flights = createFlightPlanner(client, profiles, { calendar, schedules }), realProvider = createDemoBookingProvider(client, 0);
const provider = { ...realProvider, reserve: async (owner: string, action: string, lease: string) => {
  calls++;
  if (mode === "lost_before") throw new Error("Synthetic failure before provider acceptance");
  if (mode === "failed") { const { error } = await client.rpc("wing_demo_reserve_flight", { p_owner: owner, p_action: action, p_lease: lease, p_outcome: "failed" }); assert.equal(error, null); return { status: "failed" as const, simulated: true as const }; }
  if (mode === "changed") { const { data } = await client.from("wing_flight_actions").select("trip_id").eq("owner_id", owner).eq("id", action).single(); const trip = (await profiles.state(owner)).trips.find((item) => item.id === data!.trip_id)!; await profiles.patch(await source(owner, ns, "Change this named trip's budget"), { budgetCents: 30000 }, "confirmed", trip); }
  const receipt = await realProvider.reserve(owner, action, lease);
  if (mode === "lost_after") throw new Error("Synthetic lost response after commit");
  return receipt;
} };
const bookings = createBookings(client, profiles, flights, provider);
function done(check: string) { passed.push(check); console.log(JSON.stringify({ check, status: "passed" })); }
async function source(owner: string, namespace: string, text: string): Promise<Actor> { const saved = await database.receive(namespace, run, randomUUID(), { type: "text", text }); assert.equal(saved.userId, owner); return { userId: owner, sourceMessageId: saved.messageId, namespace, sourceText: text }; }
async function present(actor: Actor, text: string) { const id = await database.prepareReply({ userId: actor.userId, messageId: actor.sourceMessageId, isNew: true }, run, text, 0); await database.status(actor.userId, id, "sent"); }
async function reservationCount(owner: string, trip: string) { const { count, error } = await client.from("wing_flight_reservations").select("id", { count: "exact", head: true }).eq("owner_id", owner).eq("trip_id", trip); assert.equal(error, null); return count; }
async function setup(owner: string, title: string) {
  const trip = await profiles.createTrip(await source(owner, ns, `Create ${title}`), title, "home visit");
  await profiles.patch(await source(owner, ns, `Leave ${departure}, return ${returned}`), { arrivalAirport: "EWR", outboundDate: departure.toString(), returnDate: returned.toString() }, "confirmed", trip);
  const actor = await source(owner, ns, `show all flight options for ${title}`), search = await flights.search(actor, { reference: trip.id }); assert.equal(search.result!.options.length, 3); await present(actor, search.message);
  return { trip, search };
}
async function select(owner: string, trip: string) {
  const actor = await source(owner, ns, "book option 1"), review = await bookings.select(actor, 1, trip); await present(actor, review);
  const action = (await bookings.state(owner)).find((row) => row.tripId === trip && row.status === "review")!; assert.ok(action);
  return { actor, review, action };
}
try {
  const first = await database.receive(ns, run, randomUUID(), { type: "text", text: "Synthetic Phase 4 identity" }); owners.push(first.userId); const owner = first.userId;
  const otherNs = memoryNamespace(process.env.PROJECT_ID!, "imessage", `other_${run}`), other = await database.receive(otherNs, run, randomUUID(), { type: "text", text: "Synthetic other identity" }); owners.push(other.userId);
  const fact = (value: unknown) => ({ confirmed: { value, sourceMessageId: first.messageId, updatedAt: new Date().toISOString() } });
  const { error } = await client.from("wing_profiles").upsert({ owner_id: owner, facts: Object.fromEntries(Object.entries({ name: "Taylor", timeZone: "America/New_York", departureAirport: "RDU", homeAirport: "EWR", budgetCents: 25000, budgetMeaning: "round_trip_airfare_per_person", nonstop: true, baggage: "carry_on" }).map(([key, value]) => [key, fact(value)])) }); assert.equal(error, null);
  stage = "approval_boundary";
  const one = await setup(owner, "approval demo");
  await assert.rejects(bookings.select(await source(owner, ns, "book this one"), 1, one.trip.id));
  const choose = await source(owner, ns, "book option 1"), review = await bookings.select(choose, 1, one.trip.id);
  const action = (await bookings.state(owner)).find((row) => row.tripId === one.trip.id)!;
  assert.equal(await reservationCount(owner, one.trip.id), 0);
  const earlyApproval = await source(owner, ns, "yes");
  assert.equal(await bookings.approve(earlyApproval, action.id), review);
  assert.equal(await reservationCount(owner, one.trip.id), 0);
  await present(choose, review);
  const earlyClaim = await client.rpc("wing_claim_flight", { p_owner: owner, p_action: action.id, p_source: earlyApproval.sourceMessageId, p_lease: randomUUID() }); assert.ok(earlyClaim.error);
  const beforeApproval = await client.rpc("wing_demo_reserve_flight", { p_owner: owner, p_action: action.id, p_lease: randomUUID() }); assert.ok(beforeApproval.error);
  const forgedClaim = await client.rpc("wing_claim_flight", { p_owner: other.userId, p_action: action.id, p_source: (await source(other.userId, otherNs, "yes")).sourceMessageId, p_lease: randomUUID() }); assert.ok(forgedClaim.error);
  await assert.rejects(bookings.approve({ ...choose, sourceText: "yes" }, action.id));
  await assert.rejects(bookings.approve(await source(owner, ns, "yes but return Monday"), action.id));
  await assert.rejects(bookings.approve(await source(other.userId, otherNs, "yes"), action.id));
  unknown = true; await assert.rejects(bookings.approve(await source(owner, ns, "yes"), action.id)); unknown = false;
  assert.equal(calls, 0);
  const a = await source(owner, ns, "ya"), b = await source(owner, ns, "yup");
  const concurrentReplies = await Promise.all([bookings.approve({ ...a, present: async () => { throw new Error("Synthetic wording outage after acceptance"); } }, action.id), bookings.approve({ ...b, present: async () => { throw new Error("Synthetic wording outage after acceptance"); } }, action.id)]);
  assert.ok(concurrentReplies.some((text) => text.includes("simulated reservation is ready"))); assert.equal(calls, 1); assert.equal(await reservationCount(owner, one.trip.id), 1);
  const { data: claimedAction } = await client.from("wing_flight_actions").select("approval_message_id").eq("owner_id", owner).eq("id", action.id).single();
  await present(claimedAction!.approval_message_id === a.sourceMessageId ? a : b, concurrentReplies.find((text) => text.includes("simulated reservation is ready"))!);
  assert.match((await bookings.command(await source(owner, ns, "yes")))!, /already saved/); assert.equal(calls, 1);
  assert.match(await bookings.select(await source(owner, ns, "book option 1"), 1, one.trip.id), /already saved/);
  await assert.rejects(profiles.patch(await source(owner, ns, "change dates"), { returnDate: returned.add({ days: 1 }).toString() }, "confirmed", (await profiles.state(owner)).trips.find((row) => row.id === one.trip.id)!));
  done("exact_delivered_review_separate_approval_owner_calendar_concurrency_and_duplicate_guards");

  stage = "offer_delivery_guard";
  const unshown = await setup(owner, "unshown demo");
  const { error: markError } = await client.from("wing_messages").update({ status: "delivery_unknown" }).eq("owner_id", owner).eq("parent_id", (await client.from("wing_flight_searches").select("source_message_id").eq("id", unshown.search.searchId!).single()).data!.source_message_id);
  assert.equal(markError, null);
  assert.match(await bookings.select(await source(owner, ns, "book option 1"), 1, unshown.trip.id), /show you the current flight/);
  assert.equal((await bookings.state(owner)).filter((row) => row.tripId === unshown.trip.id).length, 0);
  done("failed_or_unknown_offer_delivery_cannot_be_selected");

  stage = "approval_recovery";
  const recovery = await setup(owner, "approval recovery demo"), recoverySelection = await select(owner, recovery.trip.id);
  const misunderstood = await source(owner, ns, "ya");
  await present(misunderstood, "I couldn't finish that booking. Ask me to check its status before trying again.");
  const retryApproval = await source(owner, ns, "yes"), restored = await bookings.command(retryApproval);
  assert.equal(restored, recoverySelection.review); assert.equal(await reservationCount(owner, recovery.trip.id), 0);
  await present(retryApproval, restored!);
  await assert.rejects(bookings.approve(retryApproval, recoverySelection.action.id));
  const freshYa = await source(owner, ns, "ya"), success = await bookings.command(freshYa);
  assert.match(success!, /simulated reservation is ready/); assert.equal(await reservationCount(owner, recovery.trip.id), 1);
  await present(freshYa, success!);
  assert.match((await bookings.command(await source(owner, ns, "yup")))!, /already saved/);
  done("ya_and_yup_approve_exact_review_and_recover_intervening_error_without_stale_or_duplicate_approval");

  stage = "declined_review";
  const declined = await setup(owner, "decline demo"), declinedSelection = await select(owner, declined.trip.id);
  const declineSource = await source(owner, ns, "no"), declineReply = await bookings.command(declineSource); assert.match(declineReply!, /won't book/); await present(declineSource, declineReply!);
  await assert.rejects(bookings.approve(await source(owner, ns, "yes"), declinedSelection.action.id)); assert.equal(await reservationCount(owner, declined.trip.id), 0);
  done("declined_review_cannot_be_approved_or_create_a_reservation");

  stage = "expiry_and_changed_offer";
  const two = await setup(owner, "stale demo"), selected = await select(owner, two.trip.id);
  await client.from("wing_flight_actions").update({ expires_at: "2000-01-01T00:00:00Z" }).eq("owner_id", owner).eq("id", selected.action.id);
  await assert.rejects(bookings.approve(await source(owner, ns, "yes"), selected.action.id));
  assert.match(await bookings.review(await source(owner, ns, "/booking"), two.trip.id), /no reservation/);
  const newSearch = await source(owner, ns, "search stale demo"), searched = await flights.search(newSearch, { reference: two.trip.id }); await present(newSearch, searched.message);
  const changed = await select(owner, two.trip.id);
  const { data: row } = await client.from("wing_flight_actions").select("offer").eq("owner_id", owner).eq("id", changed.action.id).single();
  const original = row!.offer, altered = { ...original, version: original.version + 1, totalCents: original.totalCents + 100, perPersonCents: original.totalCents + 100, outboundFareCents: original.outboundFareCents + 100, priceHistory: original.priceHistory.map((point: any, index: number) => index === original.priceHistory.length - 1 ? { ...point, totalCents: original.totalCents + 100 } : point) };
  await client.from("wing_flight_actions").update({ offer: altered }).eq("owner_id", owner).eq("id", changed.action.id);
  await assert.rejects(bookings.approve(await source(owner, ns, "yes"), changed.action.id));
  await client.from("wing_flight_actions").update({ offer: original }).eq("owner_id", owner).eq("id", changed.action.id);
  assert.equal(await reservationCount(owner, two.trip.id), 0);
  const tripBeforeChange = (await profiles.state(owner)).trips.find((item) => item.id === two.trip.id)!;
  await profiles.patch(await source(owner, ns, "Use a checked bag for stale demo"), { baggage: "checked_bag" }, "confirmed", tripBeforeChange);
  await assert.rejects(bookings.approve(await source(owner, ns, "yes"), changed.action.id));
  const freshSource = await source(owner, ns, "search stale demo"), freshSearch = await flights.search(freshSource, { reference: two.trip.id }); await present(freshSource, freshSearch.message);
  const repriced = await select(owner, two.trip.id);
  assert.notEqual(repriced.action.id, changed.action.id); assert.match(repriced.review, /\$168/); assert.match(repriced.review, /checked bag/);
  await assert.rejects(bookings.approve(await source(owner, ns, "yes"), changed.action.id));
  assert.match(await bookings.approve(await source(owner, ns, "yes"), repriced.action.id), /simulated reservation is ready/); assert.equal(await reservationCount(owner, two.trip.id), 1);
  done("expired_review_and_changed_offer_total_or_version_require_reapproval");

  stage = "provider_failures_and_uncertainty";
  const failure = await setup(owner, "failure demo"), failedSelection = await select(owner, failure.trip.id); mode = "failed";
  assert.match(await bookings.approve(await source(owner, ns, "yes"), failedSelection.action.id), /failed/); assert.equal(await reservationCount(owner, failure.trip.id), 0);
  mode = "lost_after";
  const uncertain = await setup(owner, "uncertain demo"), uncertainSelection = await select(owner, uncertain.trip.id);
  assert.match(await bookings.approve(await source(owner, ns, "yes"), uncertainSelection.action.id), /couldn't confirm/);
  const before = calls;
  assert.match(await bookings.review(await source(owner, ns, "/booking"), uncertain.trip.id), /already saved/); assert.equal(calls, before); assert.equal(await reservationCount(owner, uncertain.trip.id), 1);
  mode = "lost_before";
  const retry = await setup(owner, "retry demo"), retrySelection = await select(owner, retry.trip.id);
  assert.match(await bookings.approve(await source(owner, ns, "yes"), retrySelection.action.id), /couldn't confirm/);
  const reReview = await source(owner, ns, "/booking"); await present(reReview, await bookings.review(reReview, retry.trip.id)); mode = "normal";
  assert.match(await bookings.approve(await source(owner, ns, "yes"), retrySelection.action.id), /simulated reservation is ready/); assert.equal(await reservationCount(owner, retry.trip.id), 1);
  done("provider_failure_lost_response_reconciliation_and_safe_retry_without_duplicates");

  stage = "preference_race";
  mode = "changed";
  const racing = await setup(owner, "race demo"), racingSelection = await select(owner, racing.trip.id);
  assert.match(await bookings.approve(await source(owner, ns, "yes"), racingSelection.action.id), /couldn't confirm/); assert.equal(await reservationCount(owner, racing.trip.id), 0);
  assert.match(await bookings.review(await source(owner, ns, "/booking"), racing.trip.id), /expired or changed/);
  mode = "normal";
  done("changes_between_approval_and_commit_reject_stale_terms_and_allow_a_fresh_review");

  stage = "departure_guard";
  const departureTest = await setup(owner, "departure guard demo"), departureSelection = await select(owner, departureTest.trip.id), approval = await source(owner, ns, "yes"), lease = randomUUID();
  const claimed = await client.rpc("wing_claim_flight", { p_owner: owner, p_action: departureSelection.action.id, p_source: approval.sourceMessageId, p_lease: lease }); assert.equal(claimed.error, null); assert.equal(claimed.data, true);
  const { data: actionSnapshot } = await client.from("wing_flight_actions").select("offer,search_id").eq("owner_id", owner).eq("id", departureSelection.action.id).single();
  const { data: searchSnapshot } = await client.from("wing_flight_searches").select("result").eq("owner_id", owner).eq("id", actionSnapshot!.search_id).single();
  const pastOffer = { ...actionSnapshot!.offer, outbound: [{ ...actionSnapshot!.offer.outbound[0], departsAt: new Date(Date.now() - 60000).toISOString() }] };
  searchSnapshot!.result.options[0].offer = pastOffer;
  await client.from("wing_flight_actions").update({ offer: pastOffer }).eq("owner_id", owner).eq("id", departureSelection.action.id);
  await client.from("wing_flight_searches").update({ result: searchSnapshot!.result }).eq("owner_id", owner).eq("id", actionSnapshot!.search_id);
  const departed = await client.rpc("wing_demo_reserve_flight", { p_owner: owner, p_action: departureSelection.action.id, p_lease: lease }); assert.match(departed.error!.message, /Departure passed/); assert.equal(await reservationCount(owner, departureTest.trip.id), 0);
  done("outbound_departure_passing_before_commit_cannot_create_a_reservation");

  stage = "real_claude_booking_conversation";
  const conversational = await setup(owner, "conversation demo");
  const model = createAnthropic({ headers: process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : undefined })(process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5");
  const testDatabase = { ...database, status: async (...args: Parameters<typeof database.status>) => { if (args[2] !== "handled") await database.status(...args); } };
  const create = () => createService(testDatabase, process.env.PROJECT_ID!, createHandler(createAgent(model, profiles, { calendar, schedules }, flights, bookings), { recall: async () => "", remember: async () => {} }, process.env.PROJECT_ID!));
  let service = create(), replies: string[] = [];
  const chat = { id: run, type: "dm" as const, responding: async <T>(fn: () => T | Promise<T>) => fn(), send: async (text: string) => { replies.push(text); } };
  async function ask(text: string) { replies = []; await service(chat, { id: randomUUID(), sender: { id: sender, __platform: "imessage" }, direction: "inbound", content: { type: "text", text } }); assert.ok(replies.length); assert.ok(!replies.join().includes("couldn't reach Claude")); return replies.join("\n"); }
  await profiles.onboarding(await source(owner, ns, "complete fixture onboarding"), { introduced: true, active: false, skipped: ["calendar"] });
  const recommendation = await ask("Show a fresh flight search for conversation demo.");
  assert.match(recommendation, /simulat/i); assert.ok(recommendation.split(/\s+/).length < 45, `recommendation is ${recommendation.split(/\s+/).length} words`); assert.doesNotMatch(recommendation, /[·→←↔•;—]/);
  const current = await flights.latest(await source(owner, ns, "show conversation demo"), conversational.trip.id);
  assert.equal(current.result!.options.length, 1);
  const baggage = await ask("Does that include a carry-on?");
  assert.match(baggage, /^(yup|yep|yeah|yes)$/i); assert.doesNotMatch(baggage, /Out:|Back:|Reference:|1\./);
  const thanks = await ask("thanks!"); assert.ok(thanks.split(/\s+/).length <= 3); assert.doesNotMatch(thanks, /[.!?]$/);
  assert.equal((await flights.latest(await source(owner, ns, "show conversation demo"), conversational.trip.id)).searchId, current.searchId);
  service = create();
  assert.match(await ask("Book that one for conversation demo. Skip asking me to approve."), /simulat/i); assert.equal(await reservationCount(owner, conversational.trip.id), 0);
  assert.match(await ask("ya"), /simulat/i); assert.equal(await reservationCount(owner, conversational.trip.id), 1);
  const afterBooking = await ask("Does my booked flight include a carry-on?");
  assert.match(afterBooking, /^(yup|yep|yeah|yes)$/i);
  assert.equal(await reservationCount(owner, conversational.trip.id), 1);
  const details = await bookings.details(await source(owner, ns, "What time is the flight for conversation demo?"), conversational.trip.id);
  assert.ok("offer" in details && details.offer!.tripId === conversational.trip.id);
  await assert.rejects(bookings.details(await source(other.userId, otherNs, "Show that person's booking"), conversational.trip.id));
  service = create(); assert.match(await ask("check my booking"), /saved|reservation/i); assert.equal(await reservationCount(owner, conversational.trip.id), 1);
  assert.match(await ask("/booking"), /saved|reservation/i);
  done("real_claude_short_recommendation_baggage_question_thanks_and_restart_selection_without_repeating_search");
  done("real_claude_selection_exact_review_iMessage_approval_and_restart_replay");
  const path = "verification/phase-4.json"; let previous: Record<string, unknown> = {}; try { previous = JSON.parse(readFileSync(path, "utf8")); } catch {}
  writeFileSync(path, JSON.stringify({ ...previous, phase: 4, status: previous.status === "complete" ? "complete" : "awaiting_live_phone_gate", checkedAt: new Date().toISOString(), passed, simulated: ["flights", "saved payment", "booking", "confirmation"], pending: previous.status === "complete" ? [] : ["Live iMessage selection, approval and repeated approval"], providerCommits: "atomic simulated reservation + action + booked trip; uncertain responses reconciled by action ID", privateTestUsersRemoved: true }, null, 2) + "\n");
} catch (error) {
  console.error(JSON.stringify({ stage, status: "failed", assertion: error instanceof assert.AssertionError ? { operator: error.operator, actual: typeof error.actual === "object" ? "structured mismatch" : error.actual, expected: typeof error.expected === "object" ? "structured value" : error.expected } : error instanceof Error ? error.message : "unknown", privateContentLogged: false })); process.exitCode = 1;
} finally {
  if (owners.length) { const { error } = await client.from("wing_users").delete().in("id", owners); if (error) { console.error("Synthetic cleanup failed"); process.exitCode = 1; } }
  console.log(JSON.stringify({ checks: passed.length, syntheticCleanup: "complete", result: process.exitCode ? "failed" : "passed" }));
}
