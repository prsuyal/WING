import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { offerSchema, segmentSchema } from "./contracts.ts";
import { airportZone, nearbyAirports } from "./airports.ts";
import type { Offer, Preferences } from "./flights.ts";

export class FlightSearchError extends Error {}
const endpoint = "https://serpapi.com/search.json";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const airport = z.object({ id: z.string().regex(/^[A-Z]{3}$/), time: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/) });
const rawFlight = z.object({ departure_airport: airport, arrival_airport: airport, airline: z.string().min(1), flight_number: z.string().min(2), travel_class: z.string(), duration: z.number().positive() });
const rawOption = z.object({ flights: z.array(rawFlight).min(1).max(4), price: z.number().positive().max(100000), type: z.literal("Round trip"), departure_token: z.string().max(12000).optional(), extensions: z.array(z.string()).optional() });
const responseSchema = z.object({ error: z.string().optional(), search_parameters: z.object({ currency: z.literal("USD") }), best_flights: z.array(z.unknown()).max(100).optional(), other_flights: z.array(z.unknown()).max(100).optional(), selected_flights: z.array(z.unknown()).optional() });
type RawOption = z.infer<typeof rawOption>;
export function realSegments(option: RawOption) {
  return option.flights.map((flight) => {
    if (flight.travel_class !== "Economy") throw new Error("Mixed cabin quote");
    const instants = (point: z.infer<typeof airport>) => {
      const local = Temporal.PlainDateTime.from(point.time.replace(" ", "T")), zone = airportZone(point.id);
      return [...new Set((["earlier", "later"] as const).map((disambiguation) => local.toZonedDateTime(zone, { disambiguation })).filter((value) => value.toPlainDateTime().equals(local)).map((value) => value.toInstant().toString()))];
    };
    const matches = instants(flight.departure_airport).flatMap((departsAt) => instants(flight.arrival_airport).filter((arrivesAt) => Math.abs(Temporal.Instant.from(arrivesAt).since(departsAt).total("minutes") - flight.duration) <= 3).map((arrivesAt) => ({ departsAt, arrivesAt })));
    if (matches.length !== 1) throw new Error("Flight duration and local times disagree or are ambiguous");
    const { departsAt, arrivesAt } = matches[0]!;
    return segmentSchema.parse({ flightNumber: flight.flight_number, departureAirport: flight.departure_airport.id, arrivalAirport: flight.arrival_airport.id, departsAt, arrivesAt, departureTimeZone: airportZone(flight.departure_airport.id), arrivalTimeZone: airportZone(flight.arrival_airport.id) });
  });
}
function options(response: z.infer<typeof responseSchema>) {
  return [...response.best_flights ?? [], ...response.other_flights ?? []].flatMap((item) => { const parsed = rawOption.safeParse(item); return parsed.success ? [parsed.data] : []; });
}
export function realOffer(ownerId: string, tripId: string, outward: RawOption, inward: RawOption, baggage: Preferences["baggage"], quotedAt: string): Offer {
  quotedAt = Temporal.Instant.from(quotedAt).toString();
  const outbound = realSegments(outward), inbound = realSegments(inward), totalCents = Math.round(inward.price * 100);
  const comparisonKey = `serpapi-v1:${hash({ outbound, inbound, baggage, cabin: "economy", travelers: 1, currency: "USD" })}`;
  const terms = { totalCents, baggage };
  return offerSchema.parse({ id: `live_${hash(comparisonKey).slice(0, 24)}`, version: parseInt(hash(terms).slice(0, 7), 16) + 1, ownerId, tripId, outbound, inbound, totalCents, perPersonCents: totalCents, currency: "USD", cabin: "economy", travelers: 1, airline: [...new Set([...outward.flights, ...inward.flights].map((flight) => flight.airline))].join(" / "), inventoryVersion: "serpapi-v1", simulated: false,
    baggage: `${baggage.replaceAll("_", " ")} requested; allowance and extra fees unconfirmed`, outboundFareCents: null, inboundFareCents: null, baggageFeeCents: null, comparisonKey,
    expiresAt: Temporal.Instant.from(quotedAt).add({ minutes: 15 }).toString(), priceHistory: [{ observedAt: quotedAt, totalCents, simulated: false }] });
}
export function createLiveFlights(key: string, client: SupabaseClient, request = fetch) {
  async function load(params: Record<string, string>, fresh: boolean) {
    const cacheKey = hash(params);
    if (!fresh) {
      const { data, error } = await client.from("wing_search_cache").select("response,quoted_at,expires_at").eq("key", cacheKey).maybeSingle();
      if (error) throw new FlightSearchError("flight search cache is unavailable — try again shortly");
      if (data && Date.parse(data.expires_at) > Date.now()) return { response: responseSchema.parse(data.response), quotedAt: Temporal.Instant.from(data.quoted_at).toString() };
    }
    const { data: allowed, error: quotaError } = await client.rpc("wing_use_search_request");
    if (quotaError || !allowed) throw new FlightSearchError("live search limit reached — try later or reuse a recent search");
    let body: unknown;
    try {
      const result = await request(`${endpoint}?${new URLSearchParams({ ...params, api_key: key, no_cache: "true" })}`, { signal: AbortSignal.timeout(30000) });
      if (!result.ok) throw new Error("Provider unavailable");
      const text = await result.text();
      if (text.length > 2_000_000) throw new Error("Response too large");
      body = JSON.parse(text);
    } catch { throw new FlightSearchError("couldn't reach live flight search — try again in a moment"); }
    const parsed = responseSchema.safeParse(body);
    if (!parsed.success || parsed.data.error) throw new FlightSearchError("live flight search couldn't return a verified quote — try different dates or airports");
    const quotedAt = new Date().toISOString();
    const { error } = await client.from("wing_search_cache").upsert({ key: cacheKey, response: parsed.data, quoted_at: quotedAt, expires_at: Temporal.Instant.from(quotedAt).add({ minutes: 10 }).toString() });
    if (error) throw new FlightSearchError("couldn't save the live quote — try again shortly");
    return { response: parsed.data, quotedAt };
  }
  return async (owner: string, tripId: string, preferences: Preferences, pairs: { outboundDate: string; returnDate: string }[], nearby: boolean, _now: string, target?: Offer, fresh = false) => {
    if (!key.trim()) throw new FlightSearchError("live flight search isn't connected yet");
    const departure = nearby ? nearbyAirports(preferences.departureAirport) : [preferences.departureAirport], arrival = nearby ? nearbyAirports(preferences.arrivalAirport) : [preferences.arrivalAirport];
    const all: Offer[] = [];
    // Bound a flexible search to three date pairs and six provider calls; never scan an unbounded calendar.
    for (const pair of pairs.slice(0, 3)) {
      const params = { engine: "google_flights", type: "1", departure_id: departure.join(","), arrival_id: arrival.join(","), outbound_date: pair.outboundDate, return_date: pair.returnDate, adults: "1", currency: "USD", hl: "en", gl: "us", travel_class: "1", stops: preferences.nonstop ? "1" : "0", bags: preferences.baggage === "carry_on" ? "1" : "0", sort_by: "2" };
      const first = await load(params, fresh);
      const outward = options(first.response).filter((option) => {
        try { const segments = realSegments(option); return !!option.departure_token && departure.includes(segments[0]!.departureAirport) && arrival.includes(segments.at(-1)!.arrivalAirport) && (!target || JSON.stringify(segments) === JSON.stringify(target.outbound)); } catch { return false; }
      }).slice(0, pairs.length > 1 || target ? 1 : 3);
      for (const out of outward) {
        const back = await load({ ...params, departure_token: out.departure_token! }, fresh);
        for (const inward of options(back.response).slice(0, 6)) {
          try {
            const offer = realOffer(owner, tripId, out, inward, preferences.baggage, first.quotedAt < back.quotedAt ? first.quotedAt : back.quotedAt);
            const localDate = (segment: Offer["outbound"][number]) => Temporal.Instant.from(segment.departsAt).toZonedDateTimeISO(segment.departureTimeZone).toPlainDate().toString();
            if (localDate(offer.outbound[0]!) !== pair.outboundDate || localDate(offer.inbound[0]!) !== pair.returnDate) continue;
            if (target && offer.comparisonKey !== target.comparisonKey) continue;
            if (!all.some((existing) => existing.id === offer.id)) all.push(offer);
          } catch { /* Skip malformed or incoherent provider rows, never repair them with invented terms. */ }
        }
      }
    }
    return all;
  };
}
export type LiveFlightSearch = ReturnType<typeof createLiveFlights>;
