import assert from "node:assert/strict";
import { loadEnvFile } from "node:process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { Temporal } from "@js-temporal/polyfill";
import { createClient } from "@supabase/supabase-js";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createDatabase } from "../src/database.ts";
import { createProfileStore } from "../src/profile.ts";
import { createCalendar } from "../src/calendar.ts";
import { createScheduleStore } from "../src/schedule-store.ts";
import { createFlightPlanner } from "../src/flight-store.ts";
import { createBookings, createDemoBookingProvider } from "../src/booking.ts";
import { createJourneys } from "../src/journey.ts";
import { createAlerts } from "../src/alerts.ts";
import { createAlertWorker } from "../src/alert-worker.ts";
import { credentialVault } from "../src/credentials.ts";
import { createAgent } from "../src/agent.ts";
import { memoryNamespace } from "../src/memory.ts";
import type { Actor } from "../src/contracts.ts";
loadEnvFile();
const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) } });
const database = createDatabase(client), profiles = createProfileStore(client), schedules = createScheduleStore(client), run = randomUUID(), owners: string[] = [], namespaces = new Map<string, string>(), passed: string[] = [], events = new Map<string, any>();
const zones = ["America/New_York", "America/Los_Angeles", "Europe/London", "Asia/Tokyo", "Pacific/Auckland", "Pacific/Honolulu"];
const hour = (zone: string) => Temporal.Now.zonedDateTimeISO(zone).hour;
const dayZone = zones.find((zone) => hour(zone) >= 8 && hour(zone) < 22)!, nightZone = zones.find((zone) => hour(zone) < 8 || hour(zone) >= 22)!;
assert.ok(dayZone && nightZone);
let stage = "setup", calendarBroken = false, transportMode: "normal" | "before" | "after" = "normal", sendCalls = 0;
const sent: string[] = [], json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const calendar = createCalendar(client, { baseUrl: "http://localhost:3000", clientId: "synthetic", clientSecret: "synthetic", encryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY!, fetch: async (input, init) => {
  const url = new URL(String(input)); assert.equal(url.hostname, "www.googleapis.com");
  if (calendarBroken) return json({}, 503);
  if (url.pathname.endsWith("calendarList")) return json({ items: [{ id: `synthetic_${run}`, summary: "Synthetic phase 7 calendar", primary: true, accessRole: "owner", timeZone: "America/New_York" }] });
  const base = `/calendar/v3/calendars/synthetic_${run}/events`, id = url.pathname.slice(base.length + 1); assert.ok(url.pathname.startsWith(base));
  if (init?.method === "POST") { const event = JSON.parse(String(init.body)); assert.ok(event.summary.startsWith("[simulated]")); if (events.has(event.id)) return json({}, 409); events.set(event.id, { ...event, status: "confirmed" }); return json(event); }
  if (!id) return json({ items: [], timeZone: "America/New_York" });
  if (!events.has(id)) return json({}, 404);
  const saved = events.get(id);
  return json({ ...saved, reminders: { ...saved.reminders, ...(saved.reminders.overrides ? { overrides: saved.reminders.overrides.map((item: any) => ({ minutes: item.minutes, method: item.method })) } : {}) } });
} });
const flights = createFlightPlanner(client, profiles, { calendar, schedules }), bookings = createBookings(client, profiles, flights, createDemoBookingProvider(client, 0)), journeys = createJourneys(client, profiles, calendar), alerts = createAlerts(client, profiles, flights);
function worker() { return createAlertWorker(client, flights, { async resolve(spaceId) { assert.equal(spaceId, run); if (transportMode === "before") throw new Error("Synthetic pre-send failure"); return async (text) => { sendCalls++; if (transportMode === "after") throw new Error("Synthetic send timeout"); sent.push(text); }; } }); }
async function rpc(name: string, args: object) { const result = await client.rpc(name, args); assert.equal(result.error, null, `${name}: ${result.error?.code}`); return result.data; }
async function source(owner: string, text: string): Promise<Actor> { const namespace = namespaces.get(owner)!; const item = await database.receive(namespace, run, randomUUID(), { type: "text", text }); assert.equal(item.userId, owner); return { userId: owner, sourceMessageId: item.messageId, namespace, sourceText: text }; }
async function present(actor: Actor, text: string) { const id = await database.prepareReply({ userId: actor.userId, messageId: actor.sourceMessageId, isNew: true }, run, text, 0); await database.status(actor.userId, id, "sent"); }
async function owner(zone = dayZone) {
  const ns = memoryNamespace(process.env.PROJECT_ID!, "imessage", `phase7_${randomUUID()}`), first = await database.receive(ns, run, randomUUID(), { type: "text", text: "Synthetic Phase 7 identity" }); owners.push(first.userId); namespaces.set(first.userId, ns);
  const fact = (value: unknown) => ({ confirmed: { value, sourceMessageId: first.messageId, updatedAt: new Date().toISOString() } });
  assert.equal((await client.from("wing_profiles").upsert({ owner_id: first.userId, facts: Object.fromEntries(Object.entries({ name: "Taylor", timeZone: zone, departureAirport: "RDU", homeAirport: "EWR", budgetCents: 25000, budgetMeaning: "round_trip_airfare_per_person", nonstop: true, baggage: "carry_on" }).map(([key, value]) => [key, fact(value)])) })).error, null);
  assert.equal((await client.from("wing_users").update({ demo_enabled: true }).eq("id", first.userId)).error, null);
  const vault = credentialVault(process.env.CREDENTIAL_ENCRYPTION_KEY!);
  assert.equal((await client.from("wing_calendar_connections").insert({ owner_id: first.userId, status: "connected", credentials_cipher: vault.seal(first.userId, { access: "synthetic", refresh: "synthetic", expiry: Date.now() + 3600_000, scopes: ["https://www.googleapis.com/auth/calendar.events.owned"] }), selected_ids: [`synthetic_${run}`], choices: [] })).error, null);
  return first.userId;
}
let departure = Temporal.Now.zonedDateTimeISO("America/New_York").toPlainDate().add({ days: 14 }); while (departure.dayOfWeek !== 5) departure = departure.add({ days: 1 });
async function trip(owner: string, title = "watch demo") {
  const trip = await profiles.createTrip(await source(owner, `Create ${title}`), title, "home visit"); await profiles.patch(await source(owner, `Leave ${departure}, return ${departure.add({ days: 2 })}`), { arrivalAirport: "EWR", outboundDate: departure.toString(), returnDate: departure.add({ days: 2 }).toString() }, "confirmed", trip);
  const actor = await source(owner, `search ${title}`), search = await flights.search(actor, { reference: trip.id }); assert.equal(search.result?.status, "options"); await present(actor, search.message); return trip;
}
async function watched(owner: string, notify = true, title = "watch demo", mode: "target" | "drop" = "target") {
  const selected = await trip(owner, title), actor = await source(owner, `${notify ? "watch that and text me" : "watch that"} ${mode === "target" ? "if it hits $120" : "for a $20 price drop"}`);
  const reply = await alerts.createWatch(actor, { reference: selected.id, mode, targetCents: mode === "target" ? 12000 : undefined, minimumDropCents: 2000, notify }); await present(actor, reply);
  return { trip: selected, actor, reply, watch: await activeWatch(owner, selected.id) };
}
async function activeWatch(owner: string, tripId: string) { const { data, error } = await client.from("wing_watches").select("*").eq("owner_id", owner).eq("trip_id", tripId).eq("status", "active").single(); assert.equal(error, null); return data!; }
async function notices(owner: string) { const { data, error } = await client.from("wing_notices").select("*").eq("owner_id", owner).order("created_at"); assert.equal(error, null); return data!; }
async function due(owner: string) { assert.equal((await client.from("wing_jobs").update({ due_at: new Date(Date.now() - 1000).toISOString() }).eq("owner_id", owner).eq("status", "pending")).error, null); }
async function price(owner: string, cents: number, title = "watch demo") { const actor = await source(owner, `/demo-price ${(cents / 100).toFixed(2)} ${title}`); const text = await alerts.command(actor); assert.match(text!, /simulated price set/); }
function done(check: string) { passed.push(check); console.log(JSON.stringify({ check, status: "passed" })); }
try {
  stage = "consent_scope";
  const a = await owner(), b = await owner(), passive = await watched(a, false);
  assert.match(passive.reply, /text you when it happens\?/); assert.equal(passive.watch.notify, false);
  await assert.rejects(alerts.createWatch(await source(a, "watch that at $1120"), { reference: passive.trip.id, mode: "target", targetCents: 12000 }));
  await assert.rejects(alerts.createWatch(await source(a, "watch that but don't text me"), { reference: passive.trip.id, mode: "target", targetCents: 12000, notify: true }));
  await assert.rejects(alerts.createWatch(await source(b, "watch that at $120"), { reference: passive.trip.id, mode: "target", targetCents: 12000 }));
  const invalid = await client.rpc("wing_enable_watch", { p_owner: b, p_watch: passive.watch.id, p_source: (await source(b, "ya")).sourceMessageId, p_review: passive.reply }); assert.ok(invalid.error);
  await price(a, 9800); await worker()(a); assert.equal((await notices(a)).length, 0); assert.match(await alerts.check(await source(a, "check my trip"), passive.trip.id), /\$98/);
  assert.equal(await alerts.command(await source(a, "ya but only if it is nonstop")), null);
  assert.match((await alerts.command(await source(a, "ya")))!, /got you/); assert.equal((await activeWatch(a, passive.trip.id)).notify, true);
  done("watch_ownership_exact_price_binding_explicit_and_separate_notification_consent");

  stage = "normal_worker";
  await due(a); await worker()(a); assert.equal(sent.length, 1); assert.match(sent[0]!, /\$98 round trip \(simulated prices\)/); assert.equal((await notices(a))[0]!.status, "sent");
  await due(a); await worker()(a); assert.equal(sent.length, 1);
  await price(a, 9700); await worker()(a); assert.equal(sent.length, 1);
  const latest = await flights.latest(await source(a, "show flights"), passive.trip.id); assert.equal(latest.result!.options[0]!.offer.totalCents, 13800);
  await assert.rejects(flights.verify(await source(a, "book this"), latest.searchId!, latest.result!.options[0]!.offer, latest.result!.assumptions));
  const fresh = await flights.search(await source(a, "search again"), { reference: passive.trip.id }); assert.equal(fresh.result!.options[0]!.offer.totalCents, 9700);
  assert.deepEqual(fresh.result!.options[0]!.offer.outbound, passive.watch.offer.outbound); assert.deepEqual(fresh.result!.options[0]!.offer.inbound, passive.watch.offer.inbound);
  done("synthetic_price_advances_normal_comparison_worker_unchanged_suppression_and_fresh_booking_prices");

  stage = "cooldown_quiet";
  await price(a, 7000); await worker()(a); assert.equal(sent.length, 1); assert.equal((await notices(a)).at(-1)!.status, "pending");
  assert.ok(Date.parse((await notices(a)).at(-1)!.due_at) > Date.now() + 20 * 3600_000);
  const night = await owner(nightZone), n = await watched(night); await price(night, 9800); await worker()(night); assert.equal(sent.length, 1); assert.equal((await notices(night))[0]!.status, "pending");
  assert.match(await alerts.check(await source(night, "check my trip"), n.trip.id), /\$98/);
  await client.from("wing_notices").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("owner_id", night); await worker()(night); assert.equal((await notices(night))[0]!.status, "cancelled");
  done("quiet_hours_cooldown_stale_notice_expiry_and_on_demand_reply");

  stage = "stop_restart";
  const n2 = await watched(night, true, "second watch"); await alerts.stop(await source(night, "mute first trip"), n.trip.id); assert.equal((await activeWatch(night, n2.trip.id)).status, "active");
  assert.match((await alerts.command(await source(night, "stop")))!, /stopped/); await due(night); await worker()(night); assert.equal(sent.length, 1); assert.equal((await client.from("wing_notify_state").select("paused").eq("owner_id", night).single()).data!.paused, true);
  assert.equal((await client.from("wing_jobs").select("id").eq("owner_id", night).in("status", ["pending", "processing"])).data!.length, 0);
  done("trip_mute_and_global_stop_persist_across_worker_restart_without_cancelling_travel");

  stage = "concurrency_recovery";
  const c = await owner(), cw = await watched(c, true, "watch demo", "drop"); await price(c, 11800); const before = sent.length;
  await Promise.all([worker()(c), worker()(c)]); assert.equal(sent.length, before + 1); assert.equal((await notices(c)).length, 1);
  const recovered = await owner(); await watched(recovered); await price(recovered, 9800);
  const claims = await rpc("wing_claim_jobs", { p_owner: recovered }); assert.equal(claims.length, 1);
  await client.from("wing_jobs").update({ leased_until: new Date(Date.now() - 1000).toISOString() }).eq("owner_id", recovered);
  await worker()(recovered); assert.equal((await notices(recovered))[0]!.status, "sent");
  const dirty = await owner(); await watched(dirty); await price(dirty, 11800); const dirtyClaims = await rpc("wing_claim_jobs", { p_owner: dirty }); await price(dirty, 9800);
  assert.equal(await rpc("wing_finish_alert_job", { p_owner: dirty, p_job: dirtyClaims[0].id, p_lease: dirtyClaims[0].lease, p_status: "pending", p_delay: 21600000 }), true);
  assert.ok(Date.parse((await client.from("wing_jobs").select("due_at").eq("owner_id", dirty).single()).data!.due_at) <= Date.now()); await worker()(dirty); assert.match(sent.at(-1)!, /\$98/);
  done("concurrent_claims_expired_job_recovery_and_price_change_during_processing");

  stage = "delivery_failures";
  const d = await owner(); await watched(d); await price(d, 9800); transportMode = "before"; const beforeCalls = sendCalls; await worker()(d); assert.equal(sendCalls, beforeCalls); assert.equal((await notices(d))[0]!.status, "pending");
  transportMode = "normal"; await client.from("wing_notices").update({ due_at: new Date(Date.now() - 1000).toISOString() }).eq("owner_id", d); await worker()(d); assert.equal((await notices(d))[0]!.status, "sent");
  const e = await owner(); await watched(e); await price(e, 9800); transportMode = "after"; const uncertainCalls = sendCalls; await worker()(e); assert.equal(sendCalls, uncertainCalls + 1); assert.equal((await notices(e))[0]!.status, "unknown");
  transportMode = "normal"; await due(e); await worker()(e); assert.equal(sendCalls, uncertainCalls + 1);
  assert.equal((await client.from("wing_messages").select("status").eq("owner_id", e).eq("id", (await notices(e))[0]!.message_id).single()).data!.status, "delivery_unknown");
  done("pre_send_failure_retries_but_uncertain_send_never_duplicates_after_restart");

  stage = "sending_lease";
  const f = await owner(); const fw = await watched(f); await price(f, 9800);
  const fjob = (await rpc("wing_claim_jobs", { p_owner: f }))[0]; const quote = await flights.watchQuote(f, fw.watch.search_id, fw.watch.comparison_key); assert.equal(quote.status, "available");
  await rpc("wing_observe_watch", { p_owner: f, p_watch: fw.watch.id, p_job: fjob.id, p_lease: fjob.lease, p_price: quote.offer!.totalCents, p_version: quote.offer!.version, p_text: "test demo notice" });
  const notice = (await rpc("wing_claim_notices", { p_owner: f }))[0]; assert.ok(await rpc("wing_begin_notice", { p_owner: f, p_notice: notice.id, p_lease: notice.lease, p_payload: notice.payload }));
  await client.from("wing_notices").update({ leased_until: new Date(Date.now() - 1000).toISOString() }).eq("owner_id", f); const priorCalls = sendCalls; await worker()(f); assert.equal(sendCalls, priorCalls); assert.equal((await notices(f))[0]!.status, "unknown");
  done("crash_after_send_started_recovers_as_unknown_without_resending");

  stage = "send_time_price_race";
  const race = await owner(); await watched(race); await price(race, 9800); const callsBeforeRace = sendCalls;
  const racingWorker = createAlertWorker(client, flights, { async resolve() { await price(race, 16000); return async () => { sendCalls++; }; } });
  await racingWorker(race); assert.equal(sendCalls, callsBeforeRace); assert.equal((await notices(race))[0]!.status, "cancelled"); await worker()(race); assert.equal(sendCalls, callsBeforeRace);
  done("price_change_between_claim_and_send_cancels_stale_quote");

  stage = "changed_unknown";
  const g = await owner(); const gw = await watched(g); await price(g, 9800); calendarBroken = true; const priorNotices = (await notices(g)).length; await worker()(g); assert.equal((await notices(g)).length, priorNotices); assert.match(await alerts.check(await source(g, "check my trip"), gw.trip.id), /can't verify/); calendarBroken = false;
  await profiles.patch(await source(g, "Return Monday instead"), { returnDate: departure.add({ days: 3 }).toString() }, "confirmed", (await profiles.state(g)).trips.find((item) => item.id === gw.trip.id)!); await due(g); await worker()(g); assert.equal((await client.from("wing_watches").select("status").eq("owner_id", g).single()).data!.status, "changed");
  const restricted = await owner(); await watched(restricted); await client.from("wing_users").update({ demo_enabled: false }).eq("id", restricted); await assert.rejects(alerts.demoPrice(await source(restricted, "/demo-price 98 watch demo"), 98));
  done("unknown_calendar_and_changed_trip_suppress_alerts_demo_controls_are_account_restricted");

  stage = "reminders_calendar";
  const h = await owner(), ht = await trip(h, "reminder demo"), choose = await source(h, "book that one"), review = await bookings.select(choose, 1, ht.id); await present(choose, review); const flight = (await bookings.state(h))[0]!; assert.match(await bookings.approve(await source(h, "ya"), flight.id), /simulated reservation is ready/);
  const request = await source(h, "text me reminders for reminder demo"); assert.match(await alerts.reminders(request, ht.id), /text reminders set/); assert.match(await alerts.reminders(await source(h, "text me reminders"), ht.id), /already set/);
  const jobs = await client.from("wing_jobs").select("*").eq("owner_id", h).eq("kind", "reminder"); assert.equal(jobs.data!.length, 2); assert.ok(jobs.data!.every((job) => Date.parse(job.due_at) > Date.now()));
  const beforeReminder = sendCalls; await worker()(h); assert.equal(sendCalls, beforeReminder); await due(h); await worker()(h); assert.equal(sendCalls, beforeReminder + 1); await worker()(h); assert.equal(sendCalls, beforeReminder + 1);
  await alerts.stop(await source(h, "stop")); assert.equal((await client.from("wing_flight_reservations").select("action_id").eq("owner_id", h)).data!.length, 1);
  const plainActor = await source(h, "add flight events to my calendar"), plainReview = await journeys.proposeItinerary(plainActor, ht.id); await present(plainActor, plainReview); const plainAction = (await journeys.state(h)).find((item) => item.kind === "itinerary")!;
  assert.match(await journeys.approve(await source(h, "ya"), plainAction.id), /added/); assert.equal(events.size, 2); const beforePopup = JSON.stringify([...events.values()]);
  const requestCalendar = await source(h, "add calendar reminders for reminder demo"), eventReview = await journeys.proposeItinerary(requestCalendar, ht.id, true); assert.match(eventReview, /these reminders/); assert.match(eventReview, /popup/); assert.equal(events.size, 2); await present(requestCalendar, eventReview);
  const action = (await journeys.state(h)).find((item) => item.kind === "itinerary")!; const confirmation = await journeys.approve(await source(h, "yup"), action.id); assert.match(confirmation, /your reminders are set/); assert.equal(events.size, 4); assert.equal(JSON.stringify([...events.values()].slice(0, 2)), beforePopup); assert.ok([...events.values()].slice(2).every((event) => event.reminders.overrides[0].minutes === 0));
  await journeys.approve(await source(h, "ya"), action.id); assert.equal(events.size, 4);
  const again = await source(h, "add calendar reminders again"); assert.match(await journeys.proposeItinerary(again, ht.id, true), /already on/); assert.equal(events.size, 4);
  done("durable_text_reminders_separate_real_calendar_review_popup_readback_and_duplicate_suppression");

  stage = "claude_conversation";
  const k = await owner(), kt = await trip(k, "conversation demo");
  const anthropic = createAnthropic({ headers: process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : undefined }); const agent = createAgent(anthropic(process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5"), profiles, { calendar, schedules }, flights, bookings, journeys, alerts);
  const latestConversation = await flights.latest(await source(k, "show conversation demo"), kt.id);
  const watchActor = await source(k, "watch conversation demo if it hits $120"), watchReply = await agent([{ role: "user", content: "search conversation demo" }, { role: "assistant", content: latestConversation.presentation ?? latestConversation.message }, { role: "user", content: watchActor.sourceText }], "", watchActor); assert.match(watchReply, /text you when it happens\?/); await present(watchActor, watchReply);
  const yes = await source(k, "ya"); assert.match(await agent([{ role: "user", content: "ya" }], "", yes), /got you/);
  await price(k, 9800, "conversation demo"); const checkActor = await source(k, "check my trip conversation demo"); const checkReply = await agent([{ role: "user", content: checkActor.sourceText }], "", checkActor); assert.match(checkReply, /\$98/); assert.ok(checkReply.length < 130);
  const stopActor = await source(k, "mute conversation demo"); assert.match(await agent([{ role: "user", content: stopActor.sourceText }], "", stopActor), /muted conversation demo/);
  done("real_claude_watch_consent_short_on_demand_reply_and_trip_mute_end_to_end");
  writeFileSync("verification/phase-7.json", JSON.stringify({ phase: 7, status: "automated_checks_passed", checkedAt: new Date().toISOString(), simulatedFlightPrices: true, deliveryTransport: "captured; no human messaged by automated checks", googleCalendar: "controlled API with real persistence and approval flow", checks: passed, pending: ["Railway deployment and live on-demand price-watch checkpoint"], deferred: ["Phase 6 parent frontend and sharing links"] }, null, 2) + "\n");
} catch (error) { console.error(JSON.stringify({ status: "failed", stage, reason: error instanceof Error ? error.message.slice(0, 400) : "unknown" })); process.exitCode = 1; }
finally { if (owners.length) { const cleanup = await client.from("wing_users").delete().in("id", owners); if (cleanup.error) { console.error("Synthetic owner cleanup failed"); process.exitCode = 1; } } }
