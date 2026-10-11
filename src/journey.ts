import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isYes, understands, naturalText, offerSchema, type Actor } from "./contracts.ts";
import { actorTrip, type ProfileStore } from "./profile.ts";
import { assumptionsSchema, legText, type Offer } from "./flights.ts";
import type { Calendar } from "./calendar.ts";

const payment = "Demo Visa •••• 4242 (fictional)";
const stamp = (instant: string, zone: string) => new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(instant));
export const rideSchema = z.object({ pickup: z.string().min(5).max(500), airport: z.string().regex(/^[A-Z]{3}$/), pickupAt: z.iso.datetime(), airportAt: z.iso.datetime(), timeZone: z.string(), driveMinutes: z.number().int().positive().max(180), airportBufferMinutes: z.number().int().min(30).max(300), totalCents: z.number().int().positive(), rideType: z.literal("standard"), simulated: z.literal(true), paymentLabel: z.string(), paymentVersion: z.number().int().positive(), pickupSource: z.string() }).strict();
export type Ride = z.infer<typeof rideSchema>;
export function plannedRide(offer: Offer, pickup: string, assumptions: unknown, paymentVersion = 1, paymentLabel = payment, pickupSource = "temporary") {
  const buffers = assumptionsSchema.parse(assumptions), first = offer.outbound[0]!;
  if (buffers.originDriveMinutes === 0) throw new Error("A positive simulated driving time is required");
  const airportAt = Temporal.Instant.from(first.departsAt).subtract({ minutes: buffers.airportBufferMinutes });
  return rideSchema.parse({ pickup, airport: first.departureAirport, airportAt: airportAt.toString(), pickupAt: airportAt.subtract({ minutes: buffers.originDriveMinutes }).toString(), timeZone: first.departureTimeZone, driveMinutes: buffers.originDriveMinutes, airportBufferMinutes: buffers.airportBufferMinutes, totalCents: 3200, rideType: "standard", simulated: true, paymentLabel, paymentVersion, pickupSource });
}
export function rideReview(_id: string, ride: Ride) {
  return `reserve a standard airport ride for $${(ride.totalCents / 100).toFixed(2)}?\n${stamp(ride.pickupAt, ride.timeZone)}\n${ride.pickup} → ${ride.airport}\n${ride.driveMinutes} min drive + ${ride.airportBufferMinutes} min airport buffer (estimates)\n\nthis is simulated, no real ride, dispatch or charge\nreply yes to reserve, or no`;
}
export const itineraryEventSchema = z.object({ id: z.string().regex(/^[a-v0-9]{5,1024}$/), summary: z.string().regex(/^\[(?:DEMO|simulated)\]/), description: z.string(), location: z.string(), visibility: z.literal("private"), transparency: z.literal("transparent"), start: z.object({ dateTime: z.iso.datetime({ offset: true }), timeZone: z.string() }), end: z.object({ dateTime: z.iso.datetime({ offset: true }), timeZone: z.string() }), reminders: z.object({ useDefault: z.literal(false), overrides: z.array(z.object({ method: z.literal("popup"), minutes: z.number().int().min(0).max(1440) }).strict()).max(1).optional() }).strict(), extendedProperties: z.object({ private: z.object({ wingTrip: z.uuid(), wingItem: z.string(), wingSimulation: z.literal("true") }) }) }).strict();
export type ItineraryEvent = z.infer<typeof itineraryEventSchema>;
export function itineraryEvents(offer: Offer, flightAction: string, ride?: { id: string; data: Ride }, legacy = false): ItineraryEvent[] {
  // Preserve exact old payloads when reconciling a review created before this update.
  const event = (key: string, summary: string, location: string, start: string, end: string, startZone: string, endZone = startZone) => itineraryEventSchema.parse({ id: `de${createHash("sha256").update(`${offer.ownerId}:${offer.tripId}:${key}`).digest("hex")}`, summary: legacy ? `[DEMO] ${summary}` : `[simulated] ${summary.toLowerCase()}`, description: legacy ? "wing simulated travel itinerary — no real ticket, ride, dispatch or charge. Times are from the approved demo reservation." : "wing simulated travel itinerary, no real ticket, ride, dispatch or charge. times are from the approved reservation", location, visibility: "private", transparency: "transparent", start: { dateTime: start, timeZone: startZone }, end: { dateTime: end, timeZone: endZone }, reminders: { useDefault: false }, extendedProperties: { private: { wingTrip: offer.tripId, wingItem: key, wingSimulation: "true" } } });
  const flights = [...offer.outbound, ...offer.inbound].map((leg, index) => event(`${flightAction}:flight:${index}`, `${leg.departureAirport} → ${leg.arrivalAirport}${legacy || !offer.simulated ? ` · ${leg.flightNumber}` : ""}`, `${leg.departureAirport} → ${leg.arrivalAirport}`, leg.departsAt, leg.arrivesAt, leg.departureTimeZone, leg.arrivalTimeZone));
  if (ride) flights.unshift(event(`${ride.id}:pickup`, `airport pickup → ${ride.data.airport}`, ride.data.airport, ride.data.pickupAt, ride.data.airportAt, ride.data.timeZone));
  return flights;
}
export function reminderEvents(offer: Offer, flightAction: string, ride?: { id: string; data: Ride }, legacy = false): ItineraryEvent[] {
  const base = itineraryEvents(offer, flightAction, undefined, legacy), indexes = [0, offer.outbound.length];
  return indexes.map((index, direction) => {
    const original = base[index]!, key = `${flightAction}:reminder:${direction}`;
    const start = Temporal.Instant.from(!direction && ride ? ride.data.pickupAt : original.start.dateTime).subtract({ minutes: 30 });
    return itineraryEventSchema.parse({ ...original, id: `de${createHash("sha256").update(`${offer.ownerId}:${offer.tripId}:${key}`).digest("hex")}`, summary: `[${legacy ? "DEMO" : "simulated"}] wing ${direction ? "return flight" : ride ? "airport pickup" : "outbound flight"} reminder`, description: legacy ? "Calendar popup for simulated travel only — no real ticket, ride or charge" : "calendar popup for simulated travel only, no real ticket, ride or charge", location: !direction && ride ? ride.data.airport : original.location,
      start: { ...original.start, dateTime: start.toString() }, end: { dateTime: start.add({ minutes: 1 }).toString(), timeZone: original.start.timeZone }, reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] }, extendedProperties: { private: { ...original.extendedProperties.private, wingItem: key } } });
  });
}
const itinerarySchema = z.object({ calendarId: z.string(), calendarName: z.string(), selectionVersion: z.number().int().positive(), events: z.array(itineraryEventSchema).min(2).max(9), rideActionId: z.uuid().nullable(), purpose: z.literal("reminders").optional() }).strict();
const actionSchema = z.object({ id: z.uuid(), owner_id: z.uuid(), trip_id: z.uuid(), flight_action_id: z.uuid(), kind: z.enum(["ride", "itinerary"]), payload: z.unknown(), terms_hash: z.string(), review_text: z.string(), status: z.enum(["review", "processing", "unknown", "confirmed", "failed", "superseded"]), source_message_id: z.uuid(), trip_version: z.number().int(), expires_at: z.string(), lease: z.uuid().nullable(), leased_until: z.string().nullable() });
type Action = z.infer<typeof actionSchema>;
const hash = (data: unknown) => createHash("sha256").update(JSON.stringify(data)).digest("hex");
export function createDemoRideProvider(client: SupabaseClient, waitMs = 800) {
  return { async reserve(owner: string, id: string, lease: string) {
    await delay(waitMs);
    const { data, error } = await client.rpc("wing_finish_journey", { p_owner: owner, p_action: id, p_lease: lease, p_outcome: "confirmed" });
    if (error || data !== true) throw new Error("Demo ride outcome unavailable");
  } };
}
export function createJourneys(client: SupabaseClient, profiles: ProfileStore, calendar: Calendar, provider = createDemoRideProvider(client)) {
  async function rows(owner: string) {
    const { data, error } = await client.from("wing_journey_actions").select("*").eq("owner_id", owner).order("created_at", { ascending: false }).limit(100);
    if (error) throw new Error("Journey state unavailable");
    return (data ?? []).map((row) => actionSchema.parse(row));
  }
  async function lastReply(owner: string) {
    const { data, error } = await client.from("wing_messages").select("body,status").eq("owner_id", owner).eq("direction", "outbound").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error("Journey review delivery unavailable");
    return data?.status === "sent" ? String(data.body.text) : null;
  }
  async function booking(actor: Actor, reference?: string) {
    const trip = actorTrip(await profiles.state(actor.userId), actor, reference);
    const { data, error } = await client.from("wing_flight_reservations").select("action_id,offer").eq("owner_id", actor.userId).eq("trip_id", trip.id).single();
    if (error || !data) throw new Error("Book a flight before organizing this journey");
    const offer = offerSchema.parse(data.offer);
    if (offer.ownerId !== actor.userId || offer.tripId !== trip.id) throw new Error("Booking scope mismatch");
    const { data: action, error: actionError } = await client.from("wing_flight_actions").select("assumptions,status,offer").eq("owner_id", actor.userId).eq("id", data.action_id).single();
    if (actionError || action?.status !== "confirmed" || JSON.stringify(offerSchema.parse(action.offer)) !== JSON.stringify(offer)) throw new Error("Booking not verified");
    return { trip, offer, flightId: data.action_id as string, assumptions: assumptionsSchema.parse(action.assumptions) };
  }
  async function pickup(owner: string, tripId: string) {
    const { data: trip, error } = await client.from("wing_trips").select("pickup_override").eq("owner_id", owner).eq("id", tripId).single();
    if (error) throw new Error("Pickup unavailable");
    if (trip.pickup_override) return { address: String(trip.pickup_override.address), source: `override:${trip.pickup_override.sourceMessageId}` };
    const { data: addresses, error: addressError } = await client.from("wing_addresses").select("id,address").eq("owner_id", owner).eq("kind", "campus").eq("confirmed", true).order("updated_at", { ascending: false }).limit(1);
    if (addressError) throw new Error("Saved pickup unavailable");
    return addresses?.[0] ? { address: addresses[0].address as string, source: `address:${addresses[0].id}` } : null;
  }
  async function store(actor: Actor, booked: Awaited<ReturnType<typeof booking>>, kind: Action["kind"], payload: unknown, review: string, id: string) {
    const { data, error } = await client.rpc("wing_review_journey", { p_owner: actor.userId, p_source: actor.sourceMessageId, p_trip: booked.trip.id, p_flight: booked.flightId, p_kind: kind, p_payload: payload, p_hash: hash(payload), p_review: review, p_id: id, p_version: booked.trip.version });
    if (error) { console.error(JSON.stringify({ event: "journey_review_rejected", code: error.code, reason: ["Trip unavailable or changed", "Invalid source", "Invalid journey terms"].find((reason) => error.message.startsWith(reason)) ?? "unavailable" })); throw new Error("Journey changed; check it before retrying"); }
    const saved = (await rows(actor.userId)).find((row) => row.id === data);
    if (!saved) throw new Error("Journey review unavailable");
    return saved.status === "confirmed" ? confirmed(actor, saved, true) : saved.review_text;
  }
  function confirmation(action: Action, already = false) {
    if (action.kind === "itinerary") { const data = itinerarySchema.parse(action.payload); return `${already ? "already on" : "added to"} ${data.calendarName} in google calendar${data.purpose === "reminders" ? "! your reminders are set" : data.rideActionId ? "! your flights and pickup are there" : "! outbound and return flights are there"}`; }
    const ride = rideSchema.parse(action.payload);
    return `${already ? "already reserved" : "ride reserved"} (simulated), no real ride or charge\n${stamp(ride.pickupAt, ride.timeZone)} to ${ride.airport}\n${already ? "" : "add the flights and pickup to your google calendar?"}`.trim();
  }
  async function confirmed(actor: Actor, action: Action, already = false) {
    const facts = confirmation(action, already);
    // The committed result remains known even when conversational rendering is unavailable.
    return naturalText(actor, facts, "confirmation").catch(() => facts);
  }
  async function valid(actor: Actor, action: Action) {
    const booked = await booking(actor, action.trip_id);
    if (booked.flightId !== action.flight_action_id || hash(action.kind === "ride" ? rideSchema.parse(action.payload) : itinerarySchema.parse(action.payload)) !== action.terms_hash) throw new Error("Reviewed terms changed");
    if (action.kind === "ride") {
      const ride = rideSchema.parse(action.payload), current = await pickup(actor.userId, action.trip_id);
      if (booked.trip.version !== action.trip_version || !current || current.address !== ride.pickup || current.source !== ride.pickupSource || Date.parse(ride.pickupAt) <= Date.now()) throw new Error("Pickup changed or its time passed — request a fresh ride review");
      const { data: pay, error } = await client.from("wing_demo_payments").select("version,label").eq("owner_id", actor.userId).single();
      if (error || JSON.stringify(ride) !== JSON.stringify(plannedRide(booked.offer, current.address, booked.assumptions, pay.version, pay.label, current.source))) throw new Error("Ride terms changed");
    } else {
      const data = itinerarySchema.parse(action.payload), target = await calendar.writeTarget(actor.userId);
      if (target.calendarId !== data.calendarId || target.selectionVersion !== data.selectionVersion) throw new Error("Calendar selection changed — request a fresh review");
      const ride = data.rideActionId ? (await rows(actor.userId)).find((row) => row.id === data.rideActionId && row.kind === "ride" && row.status === "confirmed" && row.trip_id === action.trip_id) : null;
      if (data.rideActionId && !ride) throw new Error("Approved ride unavailable");
      const expected = (data.purpose === "reminders" ? reminderEvents : itineraryEvents)(booked.offer, booked.flightId, ride ? { id: ride.id, data: rideSchema.parse(ride.payload) } : undefined, data.events[0]!.summary.startsWith("[DEMO]"));
      if (JSON.stringify(data.events) !== JSON.stringify(expected)) throw new Error("Itinerary terms changed");
      if (data.purpose === "reminders" && data.events.some((event) => Date.parse(event.start.dateTime) <= Date.now())) throw new Error("Reminder time has passed");
    }
  }
  return {
    async state(owner: string) { return (await rows(owner)).map(({ id, trip_id, kind, status, review_text }) => ({ id, tripId: trip_id, kind, status, review: status === "review" ? review_text : undefined })); },
    async proposeRide(actor: Actor, reference?: string, temporaryPickup?: string): Promise<string> {
      let booked = await booking(actor, reference);
      const actions = await rows(actor.userId), replay = actions.find((row) => row.trip_id === booked.trip.id && row.kind === "ride" && row.source_message_id === actor.sourceMessageId);
      if (replay) return replay.status === "confirmed" ? confirmed(actor, replay, true) : replay.review_text;
      const existing = actions.find((row) => row.trip_id === booked.trip.id && row.kind === "ride" && ["confirmed", "processing", "unknown"].includes(row.status));
      if (existing) return this.review(actor, "ride", booked.trip.id);
      if (temporaryPickup !== undefined) {
        await profiles.pickupOverride(actor, booked.trip, z.string().trim().min(5).max(500).parse(temporaryPickup));
        booked = await booking(actor, booked.trip.id);
      }
      const location = await pickup(actor.userId, booked.trip.id);
      if (!location) return "where should the airport ride pick you up? send the street address — i'll use it just for this trip";
      const { data: pay, error } = await client.from("wing_demo_payments").select("version,label").eq("owner_id", actor.userId).single();
      if (error) throw new Error("Demo payment unavailable");
      const ride = plannedRide(booked.offer, location.address, booked.assumptions, pay.version, pay.label, location.source);
      if (Date.parse(ride.pickupAt) <= Date.now()) return "that pickup time has passed — i can't reserve it";
      const id = randomUUID(); return store(actor, booked, "ride", ride, await naturalText(actor, rideReview(id, ride)), id);
    },
    async proposeItinerary(actor: Actor, reference?: string, reminders = false): Promise<string> {
      if (reminders && !await understands(actor, "Request calendar popup reminders for this booked trip, not text reminders", /\bremind(?:er|ers)?\b/i.test(actor.sourceText))) throw new Error("Ask for calendar reminders explicitly");
      const booked = await booking(actor, reference), actions = await rows(actor.userId);
      const ride = actions.find((row) => row.trip_id === booked.trip.id && row.kind === "ride" && row.status === "confirmed");
      const current = actions.find((row) => row.trip_id === booked.trip.id && row.kind === "itinerary" && row.flight_action_id === booked.flightId && (["processing", "unknown"].includes(row.status) || row.status === "confirmed" && itinerarySchema.parse(row.payload).rideActionId === (ride?.id ?? null)) && (itinerarySchema.parse(row.payload).purpose === "reminders") === reminders);
      if (current) return this.review(actor, "itinerary", booked.trip.id);
      const target = await calendar.writeTarget(actor.userId);
      const events = (reminders ? reminderEvents : itineraryEvents)(booked.offer, booked.flightId, ride ? { id: ride.id, data: rideSchema.parse(ride.payload) } : undefined), id = randomUUID();
      if (reminders && events.some((event) => Date.parse(event.start.dateTime) <= Date.now())) throw new Error("Reminder time has passed");
      const payload = itinerarySchema.parse({ ...target, events, rideActionId: ride?.id ?? null, ...(reminders ? { purpose: "reminders" } : {}) });
      const review = `add ${reminders ? "these reminders" : "your flights"} to ${target.calendarName}?\n\n${events.map((event) => `${event.summary.replace(/^\[(?:DEMO|simulated)\] /, "")}\n${stamp(event.start.dateTime, event.start.timeZone)} → ${stamp(event.end.dateTime, event.end.timeZone)}`).join("\n\n")}\n\n${reminders ? "popup at each listed time; private, no attendees" : "private, no reminders or attendees"}\nthese are real calendar entries for simulated travel\nreply yes to add them, or no`;
      return store(actor, booked, "itinerary", payload, await naturalText(actor, review), id);
    },
    async review(actor: Actor, kind: Action["kind"], reference?: string): Promise<string> {
      const booked = await booking(actor, reference), action = (await rows(actor.userId)).find((row) => row.trip_id === booked.trip.id && row.kind === kind && row.status !== "superseded");
      if (kind === "itinerary" && /^what (?:calendar )?events[?!.\s]*$/i.test(actor.sourceText.trim())) {
        if (!action) return "no flight events added yet";
        const data = itinerarySchema.parse(action.payload);
        return naturalText(actor, `${action.status === "confirmed" ? "on your calendar" : "not added yet"}:\n${data.events.map((event) => event.summary.replace(/^\[(?:DEMO|simulated)\] /, "")).join("\n")}`, "details");
      }
      if (!action) return kind === "ride" ? this.proposeRide(actor, booked.trip.id) : this.proposeItinerary(actor, booked.trip.id);
      if (action.status === "confirmed") return confirmed(actor, action, true);
      if (action.status === "failed") return "ride failed — nothing reserved\nwant a fresh review?";
      if (action.status === "processing" && Date.parse(action.leased_until!) > Date.now()) return "still checking — haven't sent another request";
      try { await valid(actor, action); }
      catch (error) {
        if (action.status === "review") return kind === "ride" ? this.proposeRide(actor, booked.trip.id) : this.proposeItinerary(actor, booked.trip.id, kind === "itinerary" && itinerarySchema.parse(action.payload).purpose === "reminders");
        if (kind !== "ride" || !(error instanceof Error) || !/^(Pickup changed|Ride terms changed)/.test(error.message)) throw error;
        // Demo ride commits are atomic in this table, so a non-confirmed, unleased action has no reservation.
        const { data, error: saveError } = await client.from("wing_journey_actions").update({ status: "superseded" }).eq("owner_id", actor.userId).eq("id", action.id).eq("status", action.status).select("id").maybeSingle();
        if (saveError || !data) throw new Error("Ride changed during reconciliation");
        return this.proposeRide(actor, booked.trip.id);
      }
      if (Date.parse(action.expires_at) <= Date.now()) {
        if (action.status === "review") return kind === "ride" ? this.proposeRide(actor, booked.trip.id) : this.proposeItinerary(actor, booked.trip.id, kind === "itinerary" && itinerarySchema.parse(action.payload).purpose === "reminders");
        // Uncertain writes retain their IDs; renewal only permits a fresh approval of identical terms.
        const { error } = await client.from("wing_journey_actions").update({ expires_at: new Date(Date.now() + 30 * 60_000).toISOString() }).eq("owner_id", actor.userId).eq("id", action.id).eq("status", action.status).select("id").single();
        if (error) throw new Error("Journey changed during reconciliation");
      }
      return action.review_text;
    },
    async decline(actor: Actor, id: string) {
      if (!await understands(actor, "Decline the pending ride or calendar review; do not undo completed actions", /^(no|nope|cancel|cancel it)[!.\s]*$/i.test(actor.sourceText.trim()))) throw new Error("Explicit decline is required");
      const action = (await rows(actor.userId)).find((row) => row.id === z.uuid().parse(id) && row.status === "review");
      if (!action || await lastReply(actor.userId) !== action.review_text) throw new Error("Show the current review before declining it");
      const { data, error } = await client.from("wing_journey_actions").update({ status: "superseded" }).eq("owner_id", actor.userId).eq("id", id).eq("status", "review").select("id").maybeSingle();
      if (error || !data) throw new Error("That review changed, check its status first");
      return "got you, won't do that";
    },
    async approve(actor: Actor, reference: string) {
      if (actor.replyInFlight || !await understands(actor, "Approve the exact ride or calendar event review in the last delivered message without conditions or changed terms", isYes(actor.sourceText) || /^\/approve-journey [0-9a-f-]{8,36}$/i.test(actor.sourceText.trim()))) throw new Error("Separate explicit approval required");
      z.string().regex(/^[0-9a-f-]{8,36}$/i).parse(reference);
      const matches = (await rows(actor.userId)).filter((row) => row.id.startsWith(reference));
      if (matches.length !== 1) throw new Error("Journey review unavailable or ambiguous");
      const action = matches[0]!;
      if (action.status === "confirmed") return confirmed(actor, action, true);
      if (action.status === "processing" && Date.parse(action.leased_until!) > Date.now()) return "still checking — haven't sent another request";
      if (actor.sourceMessageId === action.source_message_id || Date.parse(action.expires_at) <= Date.now() || !["review", "unknown", "processing"].includes(action.status)) throw new Error("That review is no longer approvable");
      if (await lastReply(actor.userId) !== action.review_text) return this.review(actor, action.kind, action.trip_id);
      await valid(actor, action);
      const lease = randomUUID(), { data, error } = await client.rpc("wing_claim_journey", { p_owner: actor.userId, p_action: action.id, p_source: actor.sourceMessageId, p_lease: lease });
      if (error) throw new Error("Journey terms changed — request a fresh review");
      if (!data) return "still checking — haven't sent another request";
      try {
        if (action.kind === "ride") await provider.reserve(actor.userId, action.id, lease);
        else {
          const itinerary = itinerarySchema.parse(action.payload);
          for (const event of itinerary.events) {
            await valid(actor, action);
            const { data: current, error: currentError } = await client.from("wing_journey_actions").select("lease,status,leased_until").eq("owner_id", actor.userId).eq("id", action.id).single();
            if (currentError || current.status !== "processing" || current.lease !== lease || Date.parse(current.leased_until) <= Date.now()) throw new Error("Calendar approval lease expired");
            await calendar.ensureItineraryEvent(actor.userId, itinerary.calendarId, itinerary.selectionVersion, event);
          }
          const result = await client.rpc("wing_finish_journey", { p_owner: actor.userId, p_action: action.id, p_lease: lease, p_outcome: "confirmed" });
          if (result.error || result.data !== true) throw new Error("Calendar result needs reconciliation");
        }
        const saved = (await rows(actor.userId)).find((row) => row.id === action.id);
        if (saved?.status === "failed") return "ride failed — nothing reserved";
        if (saved?.status !== "confirmed") throw new Error("Journey outcome unavailable");
        return confirmed(actor, saved);
      } catch {
        await client.from("wing_journey_actions").update({ status: "unknown", lease: null, leased_until: null }).eq("owner_id", actor.userId).eq("id", action.id).eq("status", "processing").eq("lease", lease);
        return `couldn't confirm that ${action.kind === "ride" ? "ride" : "calendar write"} yet — ask me to check the ${action.kind === "ride" ? "ride" : "itinerary"} before retrying`;
      }
    },
    async command(actor: Actor): Promise<string | null> {
      const text = actor.sourceText.trim();
      if (text === "/ride") return this.review(actor, "ride");
      if (text === "/itinerary" || /^(?:what events|(?:check|show)(?: my| the)? itinerary)[?!.\s]*$/i.test(text)) return this.review(actor, "itinerary");
      if (text.startsWith("/approve-journey ")) return this.approve(actor, text.slice(17).trim());
      if (/^(?:(?:i )?(?:need|want)(?: an?| the)? |(?:get|book|arrange)(?: me)?(?: an?| the)? )?(?:uber|ride)(?: to the airport)?(?: too)?[!.\s]*$/i.test(text)) return this.proposeRide(actor);
      if (!isYes(text) && !/^(no|nope|cancel|cancel it)[!.\s]*$/i.test(text)) return null;
      const last = await lastReply(actor.userId), actions = await rows(actor.userId), current = actions.find((row) => row.review_text === last && ["review", "processing", "unknown"].includes(row.status));
      if (current) {
        if (isYes(text)) return this.approve(actor, current.id);
        if (current.status !== "review") return "might already be processing — let's check first";
        const { data, error } = await client.from("wing_journey_actions").update({ status: "superseded" }).eq("owner_id", actor.userId).eq("id", current.id).eq("status", "review").select("id").maybeSingle();
        if (error || !data) throw new Error("Journey changed while declining");
        return "got you — won't do that";
      }
      // Resolve invitations by their delivered parent's trip, never the currently active trip.
      if ((isYes(text) || /^(no|nope|no thanks)[!.\s]*$/i.test(text)) && /(?:need a ride to the airport\?|add the flights(?: and pickup)? to your (?:google )?calendar\?)$/.test(last ?? "")) {
        if (last!.startsWith("ride reserved")) {
          const ride = actions.find((row) => row.status === "confirmed" && row.kind === "ride" && confirmation(row) === last);
          if (ride) return this.proposeItinerary(actor, ride.trip_id);
        } else {
          const { data: delivered, error: deliveryError } = await client.from("wing_messages").select("parent_id").eq("owner_id", actor.userId).eq("direction", "outbound").order("created_at", { ascending: false }).limit(1).single();
          if (deliveryError) throw new Error("Booking invitation delivery unavailable");
          const { data: flights, error } = await client.from("wing_flight_actions").select("trip_id").eq("owner_id", actor.userId).eq("status", "confirmed").eq("approval_message_id", delivered.parent_id);
          if (error) throw new Error("Booking invitation unavailable");
          const flight = flights?.length === 1 ? flights[0] : null;
          if (flight) {
            if (!isYes(text)) return "want me to add the flights to your calendar?";
            return last!.endsWith("add the flights to your calendar?") ? this.proposeItinerary(actor, flight.trip_id) : this.proposeRide(actor, flight.trip_id);
          }
        }
      }
      if (isYes(text)) {
        const confirmed = actions.find((row) => row.status === "confirmed" && (confirmation(row) === last || confirmation(row, true) === last));
        if (confirmed) return confirmation(confirmed, true);
      }
      return null;
    },
  };
}
export type Journeys = ReturnType<typeof createJourneys>;
