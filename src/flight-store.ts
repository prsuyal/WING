import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import type { Actor } from "./contracts.ts";
import { airportZone, requestedNearby } from "./airports.ts";
import { actorTrip, confirmedFacts, type ProfileStore } from "./profile.ts";
import type { ScheduleServices } from "./schedule-tools.ts";
import { expandSchedule, planningRange, scheduleLabel, type Window } from "./schedule.ts";
import { assumptionsSchema, planningSchema, datePairs, demoInventory, rankFlights, flightResultSchema, formatFlights, presentedFlights, priceContext, type Assumptions } from "./flights.ts";
import { adjustedOffer } from "./notifications.ts";
import { FlightSearchError, type LiveFlightSearch } from "./live-flights.ts";

export const flightQuerySchema = z.object({ reference: z.string().optional(), flexibleDates: z.boolean().default(false), nearbyAirports: z.boolean().default(false) }).strict();
export function createFlightPlanner(client: SupabaseClient, profiles: ProfileStore, schedules: ScheduleServices, config: Partial<Assumptions> = {}, live?: LiveFlightSearch) {
  const assumptions = assumptionsSchema.parse(config);
  async function inventory(owner: string, tripId: string, preferences: z.infer<typeof planningSchema>, pairs: ReturnType<typeof datePairs>, nearby: boolean, now: string, target?: import("./flights.ts").Offer, fresh = false) {
    if (target?.simulated === false || (!target && live)) {
      if (!live) throw new FlightSearchError("live flight search isn't connected yet");
      return live(owner, tripId, preferences, pairs, nearby, now, target, fresh);
    }
    const { data, error } = await client.from("wing_demo_prices").select("comparison_key,delta_cents,version").eq("owner_id", owner).eq("trip_id", tripId);
    if (error) throw new Error("Simulated price observations unavailable");
    return demoInventory(owner, tripId, preferences, pairs, nearby, now).map((offer) => adjustedOffer(offer, data?.find((row) => row.comparison_key === offer.comparisonKey)));
  }
  async function context(owner: string, lower: string, upper: string, zone: string) {
    const range = planningRange(Temporal.PlainDate.from(lower).subtract({ days: 2 }).toString(), Temporal.PlainDate.from(upper).add({ days: 3 }).toString(), zone);
    const [rows, synced] = await Promise.all([schedules.schedules.state(owner), schedules.calendar.sync(owner, range)]);
    let unknown = synced.unknown || rows.some((row) => row.status === "candidate" && (!row.data.startDate || !row.data.endDate || (row.data.startDate <= upper && row.data.endDate >= lower)));
    const manual: Window[] = [];
    for (const row of rows.filter((row) => row.status === "confirmed")) {
      try { manual.push(...expandSchedule(row.data, range, `schedule:${row.id}`)); } catch { unknown = true; }
    }
    // Class permission applies only to a confirmed matching occurrence, not every event with that title.
    const windows = synced.windows.map((window) => ({ ...window, kind: manual.some((item) => item.kind === "class" && item.start === window.start && item.end === window.end && scheduleLabel(item.label).toLowerCase() === scheduleLabel(window.label).toLowerCase()) ? "class" as const : window.kind }));
    windows.push(...manual);
    if (windows.length > 3000) throw new Error("Narrow the planning dates; too many commitments for one search");
    return { windows, synced, unknown };
  }
  return {
    async presentation(actor: Actor, text: string) {
      const { data, error } = await client.from("wing_flight_searches").select("id,request").eq("owner_id", actor.userId).eq("source_message_id", actor.sourceMessageId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw new Error("Flight presentation unavailable");
      if (!data) return;
      const { error: updateError } = await client.from("wing_flight_searches").update({ request: { ...data.request, presentation: z.string().min(1).max(6000).parse(text) } }).eq("owner_id", actor.userId).eq("id", data.id);
      if (updateError) throw new Error("Flight presentation could not be saved");
    },
    async search(actor: Actor, input: unknown) {
      const query = flightQuerySchema.parse(input), state = await profiles.state(actor.userId), trip = actorTrip(state, actor, query.reference);
      if (trip.status !== "planning") throw new Error("This trip is no longer in planning state");
      const facts = { ...confirmedFacts(state.profile), ...confirmedFacts(trip.facts) };
      if (query.flexibleDates && !/\b(flexible|around|nearby dates|other dates|any dates|date alternatives)\b/i.test(actor.sourceText)) return { message: "are nearby departure/return dates okay, or should I keep the exact dates?" };
      if (query.nearbyAirports && !/\b(nearby|other airport|another airport|airports)\b/i.test(actor.sourceText) && ![facts.departureAirport, facts.arrivalAirport || facts.homeAirport].some((code) => typeof code === "string" && requestedNearby(code, actor.sourceText))) return { message: "should i include nearby airports for this trip?" };
      const values = { ...facts, timeZone: facts.timeZone || (typeof facts.departureAirport === "string" ? airportZone(facts.departureAirport) : undefined), arrivalAirport: facts.arrivalAirport || facts.homeAirport, allowMissedCommitments: confirmedFacts(trip.facts).allowMissedCommitments === true };
      const parsed = planningSchema.safeParse(values);
      if (!parsed.success) {
        const field = String(parsed.error.issues[0]?.path[0]);
        const questions: Record<string, string> = { departureAirport: "which airport are you leaving from?", arrivalAirport: "which airport are you flying to?", outboundDate: "what date would you like to leave?", returnDate: "what date would you like to return?", timeZone: "what time zone should I use for your travel dates?", budgetCents: "what's your per-person round-trip airfare budget?", budgetMeaning: "how much of your budget can go toward round-trip airfare? Other trip costs aren't priced yet." };
        return { message: questions[field] || "one saved travel preference needs clarification before I search. Check /profile or tell me what to change." };
      }
      const preferences = parsed.data, now = new Date().toISOString(), pairs = datePairs(preferences, query.flexibleDates, now).slice(0, live ? 3 : 6);
      const lower = pairs.reduce((date, pair) => pair.outboundDate < date ? pair.outboundDate : date, preferences.outboundDate), upper = pairs.reduce((date, pair) => pair.returnDate > date ? pair.returnDate : date, preferences.returnDate);
      const { windows, synced, unknown } = await context(actor.userId, lower, upper, preferences.timeZone);
      const unchecked = !!live && !synced.healthy && !unknown && !windows.length;
      if (unchecked && /\b(calendar|schedule|classes|commitments|free time)\b/i.test(actor.sourceText)) return { message: "connect your calendar or send your schedule so i can check which flights fit" };
      const offers = await inventory(actor.userId, trip.id, preferences, pairs, query.nearbyAirports, now);
      const result = presentedFlights({ ...rankFlights(offers, preferences, windows, synced.healthy || unchecked, unknown, assumptions, now, synced.refreshedAt, pairs.length), simulated: !live, ...(unchecked ? { scheduleChecked: false } : {}) }, actor.sourceText, query.nearbyAirports);
      const { data: previous, error: previousError } = await client.from("wing_flight_searches").select("result,request,source_message_id,expires_at,profile_version").eq("owner_id", actor.userId).eq("trip_id", trip.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (previousError) throw new Error("Previous search unavailable");
      let before: typeof result | undefined;
      if (previous?.request.presentation && previous.profile_version === state.version && Date.parse(previous.expires_at) > Date.now()) {
        const { data: sent, error } = await client.from("wing_messages").select("id").eq("owner_id", actor.userId).eq("parent_id", previous.source_message_id).eq("direction", "outbound").eq("status", "sent").eq("body->>text", previous.request.presentation).limit(1);
        if (error) throw new Error("Previous delivery unavailable");
        if (sent?.length) before = flightResultSchema.parse(previous.result);
      }
      const request = { preferences, flexibleDates: query.flexibleDates, nearbyAirports: query.nearbyAirports, pairs, profileVersion: state.version, tripVersion: trip.version };
      const key = createHash("sha256").update(JSON.stringify(request)).digest("hex");
      const expires = Temporal.Instant.from(now).add({ minutes: 15 }).toString();
      const { data: id, error } = await client.rpc("wing_save_flight_search", { p_owner: actor.userId, p_source: actor.sourceMessageId, p_trip: trip.id, p_trip_version: trip.version, p_profile_version: state.version, p_key: key, p_request: { ...request, presentation: formatFlights(result, trip.title, before) }, p_result: result, p_expires: expires });
      if (error || !id) throw new Error("Travel preferences changed or the flight search could not be saved; retry");
      const { data: saved, error: readError } = await client.from("wing_flight_searches").select("result,request,expires_at").eq("owner_id", actor.userId).eq("id", id).single();
      if (readError || Date.parse(saved.expires_at) <= Date.now()) throw new Error("Saved flight search is unavailable or expired");
      const persisted = flightResultSchema.parse(saved.result);
      return { searchId: id as string, tripId: trip.id, result: persisted, message: z.string().min(1).max(6000).parse(saved.request.presentation) };
    },
    async verify(actor: Actor, searchId: string, offer: import("./flights.ts").Offer, buffers: Assumptions) {
      const { data, error } = await client.from("wing_flight_searches").select("request,result").eq("owner_id", actor.userId).eq("id", searchId).single();
      if (error) throw new Error("Search unavailable");
      const preferences = planningSchema.parse(data.request.preferences);
      const out = Temporal.Instant.from(offer.outbound[0]!.departsAt).toZonedDateTimeISO(offer.outbound[0]!.departureTimeZone).toPlainDate().toString(), back = Temporal.Instant.from(offer.inbound[0]!.departsAt).toZonedDateTimeISO(offer.inbound[0]!.departureTimeZone).toPlainDate().toString();
      const now = new Date().toISOString(), pair = [{ outboundDate: out, returnDate: back }];
      const { windows, synced, unknown } = await context(actor.userId, out, back, preferences.timeZone);
      const offers = await inventory(actor.userId, offer.tripId, { ...preferences, departureAirport: offer.outbound[0]!.departureAirport, arrivalAirport: offer.outbound.at(-1)!.arrivalAirport }, pair, false, now, offer, !offer.simulated);
      const current = offers.find((item) => item.id === offer.id);
      const terms = (item: typeof offer) => ({ id: item.id, version: item.version, outbound: item.outbound, inbound: item.inbound, totalCents: item.totalCents, baggage: item.baggage, cabin: item.cabin });
      if (!current || JSON.stringify(terms(current)) !== JSON.stringify(terms(offer))) throw new Error("Offer terms changed; request a new review");
      const unchecked = data.result.scheduleChecked === false && !synced.healthy && !unknown && !windows.length;
      const result = rankFlights(offers, preferences, windows, synced.healthy || unchecked, unknown, buffers, now, synced.refreshedAt, 1);
      if (result.rejected.some((item) => item.offerId === offer.id) || result.status !== "options") throw new Error("That flight no longer fits the checked schedule or preferences");
      return true;
    },
    async watchQuote(owner: string, searchId: string, key: string) {
      const { data, error } = await client.from("wing_flight_searches").select("trip_id,trip_version,profile_version,request,result").eq("owner_id", owner).eq("id", searchId).single();
      if (error) throw new Error("Watched search unavailable");
      const state = await profiles.state(owner), trip = state.trips.find((row) => row.id === data.trip_id);
      if (!trip || trip.status !== "planning" || trip.version !== data.trip_version || state.version !== data.profile_version) return { status: "changed" as const };
      const watched = flightResultSchema.parse(data.result).options.find((item) => item.offer.comparisonKey === key)?.offer;
      if (!watched) throw new Error("Watched itinerary unavailable");
      if (Date.parse(watched.outbound[0]!.departsAt) <= Date.now()) return { status: "changed" as const };
      const preferences = planningSchema.parse(data.request.preferences), now = new Date().toISOString();
      const out = Temporal.Instant.from(watched.outbound[0]!.departsAt).toZonedDateTimeISO(watched.outbound[0]!.departureTimeZone).toPlainDate().toString(), back = Temporal.Instant.from(watched.inbound[0]!.departsAt).toZonedDateTimeISO(watched.inbound[0]!.departureTimeZone).toPlainDate().toString();
      const pairs = datePairs({ ...preferences, outboundDate: out, returnDate: back }, false, now);
      const { windows, synced, unknown } = await context(owner, out, back, preferences.timeZone);
      if (unknown) return { status: "unknown" as const };
      const offers = await inventory(owner, trip.id, { ...preferences, departureAirport: watched.outbound[0]!.departureAirport, arrivalAirport: watched.outbound.at(-1)!.arrivalAirport }, pairs, false, now, watched), offer = offers.find((item) => item.id === watched.id);
      if (!offer) return { status: "unavailable" as const };
      const unchecked = data.result.scheduleChecked === false && !synced.healthy && !unknown && !windows.length;
      const ranked = rankFlights(offers, preferences, windows, synced.healthy || unchecked, unknown, assumptionsSchema.parse(data.result.assumptions), now, synced.refreshedAt, 1);
      return ranked.rejected.some((item) => item.offerId === offer.id) || ranked.status !== "options" ? { status: "unavailable" as const } : { status: "available" as const, offer };
    },
    async latest(actor: Actor, reference?: string) {
      const state = await profiles.state(actor.userId), trip = actorTrip(state, actor, reference);
      const { data, error } = await client.from("wing_flight_searches").select("id,trip_id,trip_version,profile_version,result,request,created_at,expires_at").eq("owner_id", actor.userId).eq("trip_id", trip.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw new Error("Flight search unavailable");
      if (!data) return { message: "no flight search saved for this trip yet. tell me when you want to go and return." };
      if (data.trip_version !== trip.version || data.profile_version !== state.version || new Date(data.expires_at).getTime() <= Date.now()) return { message: "those options need a fresh search because they expired or your preferences changed. ask me to search again." };
      const result = flightResultSchema.parse(data.result);
      if (result.options.some((option) => option.offer.ownerId !== actor.userId || option.offer.tripId !== trip.id)) throw new Error("Flight offer ownership mismatch");
      return { searchId: data.id as string, tripId: trip.id, result, message: formatFlights(result, trip.title), presentation: z.string().min(1).max(6000).optional().parse(data.request.presentation), createdAt: z.iso.datetime({ offset: true }).parse(data.created_at) };
    },
    async compare(actor: Actor, option: number, reference?: string) {
      z.number().int().min(1).max(3).parse(option);
      const saved = await this.latest(actor, reference);
      if (!saved.result) return saved;
      const selected = saved.result.options[option - 1];
      if (!selected) return { message: "that option isn't in the saved results. choose one of the displayed numbers." };
      const price = priceContext(selected.offer);
      if (price.medianCents === null) return { price, offerId: selected.offer.id, message: `$${(price.currentCents / 100).toFixed(2)} round trip — no verified history for this exact itinerary yet` };
      return { price, offerId: selected.offer.id, message: `$${(price.currentCents / 100).toFixed(2)} now vs $${(price.medianCents / 100).toFixed(2)} typical for this same itinerary (synthetic history)\n${price.level === "low" ? "low" : price.level === "high" ? "on the high side" : "about typical"} for the demo` };
    },
  };
}
export type FlightPlanner = ReturnType<typeof createFlightPlanner>;
