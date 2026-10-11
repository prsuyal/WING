import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { Temporal } from "@js-temporal/polyfill";
import { airports, airportSchema, airportZone, findAirports } from "./airports.ts";
import { createLiveFlights, realOffer, realSegments } from "./live-flights.ts";
import { offerSchema } from "./contracts.ts";
import { briefFlightAnswer, priceContext, planningSchema, datePairs } from "./flights.ts";
import { bookingReview } from "./booking.ts";
import { adjustedOffer } from "./notifications.ts";
import { nextOnboarding } from "./onboarding.ts";

const owner = "00000000-0000-4000-8000-000000000001", trip = "00000000-0000-4000-8000-000000000002";
const now = "2026-10-11T00:00:00Z";
const preferences = planningSchema.parse({ departureAirport: "LAX", arrivalAirport: "JFK", outboundDate: "2026-11-06", returnDate: "2026-11-09", timeZone: "America/Los_Angeles", budgetCents: 70000, budgetMeaning: "round_trip_airfare_per_person", baggage: "carry_on" });
function option(from: string, to: string, starts: string, ends: string, price = 260) {
  const instant = (time: string, code: string) => Temporal.PlainDateTime.from(time.replace(" ", "T")).toZonedDateTime(airportZone(code)).toInstant();
  return { type: "Round trip" as const, price, departure_token: "test-outbound-token", flights: [{ departure_airport: { id: from, time: starts }, arrival_airport: { id: to, time: ends }, duration: instant(ends, to).since(instant(starts, from)).total("minutes"), airline: "Example Air", flight_number: "EX 123", travel_class: "Economy" }] };
}
const outward = option("LAX", "JFK", "2026-11-06 23:00", "2026-11-07 07:00", 220), inward = option("JFK", "LAX", "2026-11-09 14:00", "2026-11-09 17:00");
const quote = () => realOffer(owner, trip, outward, inward, "carry_on", now);

test("global airports validate codes and give real IANA zones; city ambiguity is visible", () => {
  assert.ok(Object.keys(airports).length > 7000);
  for (const code of Object.keys(airports)) assert.doesNotThrow(() => airportZone(code));
  for (const code of ["LAX", "NRT", "DEL", "LHR", "SYD", "AKL", "SCL"]) assert.equal(airportSchema.safeParse(code).success, true);
  assert.equal(airportSchema.safeParse("ZZZ").success, false);
  assert.deepEqual(findAirports("NYC").map((item) => item.code), ["JFK", "EWR", "LGA"]);
  assert.ok(findAirports("London").length > 1);
});

test("real round trips use the final combined price, local time zones, and no invented fees/history", () => {
  const offer = quote();
  assert.equal(offer.totalCents, 26000); assert.equal(offer.simulated, false);
  assert.equal(offer.outbound[0]!.departsAt, "2026-11-07T07:00:00Z");
  assert.equal(offer.outbound[0]!.arrivesAt, "2026-11-07T12:00:00Z");
  assert.equal(offer.outboundFareCents, null); assert.equal(offer.baggageFeeCents, null);
  assert.equal(priceContext(offer).medianCents, null); assert.equal(offer.priceHistory.length, 1);
  assert.equal(briefFlightAnswer(offer, "does that include a carry on?"), "bag allowance isn't confirmed for this fare");
  const review = bookingReview(trip, offer, [], undefined, false);
  for (const text of ["unconfirmed", "simulated booking", "no real ticket or charge", "schedule not checked"]) assert.ok(review.includes(text));
  assert.throws(() => adjustedOffer(offer, { delta_cents: -2000, version: 1 }), /real quote/);
  assert.equal(offerSchema.safeParse({ ...offer, simulated: true }).success, false);
});

test("date-line and overnight flights are parsed as instants; inconsistent/DST-ambiguous/mixed-cabin rows fail", () => {
  const crossing = option("NRT", "JFK", "2026-11-06 18:00", "2026-11-06 16:00");
  assert.equal(realSegments(crossing)[0]!.departsAt, "2026-11-06T09:00:00Z");
  assert.equal(realSegments(crossing)[0]!.arrivesAt, "2026-11-06T21:00:00Z");
  assert.throws(() => realSegments({ ...outward, flights: [{ ...outward.flights[0]!, duration: 5 }] }), /disagree/);
  assert.throws(() => realSegments({ ...outward, flights: [{ ...outward.flights[0]!, travel_class: "Business" }] }), /Mixed cabin/);
  const ambiguous = option("JFK", "LAX", "2026-11-01 01:30", "2026-11-01 05:30");
  assert.equal(realSegments(ambiguous)[0]!.departsAt, "2026-11-01T05:30:00Z");
  assert.throws(() => realSegments(option("JFK", "EWR", "2026-11-01 01:10", "2026-11-01 01:50")), /ambiguous/);
});

function harness() {
  const cache = new Map<string, any>(), queries: URL[] = [];
  let quota = true;
  const client = createClient("https://example.supabase.co", "test-key", { global: { fetch: async (url, init) => {
    const path = new URL(String(url));
    if (path.pathname.endsWith("/rpc/wing_use_search_request")) return new Response(JSON.stringify(quota));
    if (init?.method === "POST") { const row = JSON.parse(String(init.body)); cache.set(row.key, row); return new Response(null, { status: 201 }); }
    const row = cache.get(path.searchParams.get("key")?.slice(3) ?? "");
    return new Response(JSON.stringify(row ? [{ ...row, quoted_at: row.quoted_at.replace("Z", "+00:00") }] : []), { headers: { "content-type": "application/json" } });
  } } });
  const provider = createLiveFlights("private-test-key", client, async (input) => {
    const url = new URL(String(input)); queries.push(url);
    const returning = !!url.searchParams.get("departure_token");
    return new Response(JSON.stringify({ search_parameters: { currency: "USD" }, best_flights: [returning ? inward : outward] }));
  });
  return { provider, queries, deny: () => { quota = false; } };
}

test("live search joins actual legs, caches repeats, rechecks targeted quotes and refuses quota exhaustion", async () => {
  const h = harness(), current = new Date().toISOString();
  const offers = await h.provider(owner, trip, preferences, [{ outboundDate: "2026-11-06", returnDate: "2026-11-09" }], false, current);
  assert.equal(offers.length, 1); assert.equal(h.queries.length, 2); assert.equal(offers[0]!.totalCents, 26000);
  await h.provider(owner, trip, preferences, [{ outboundDate: "2026-11-06", returnDate: "2026-11-09" }], false, current);
  assert.equal(h.queries.length, 2);
  await h.provider(owner, trip, preferences, [{ outboundDate: "2026-11-06", returnDate: "2026-11-09" }], false, current, offers[0], true);
  assert.equal(h.queries.length, 4); assert.equal(h.queries[2]!.searchParams.get("no_cache"), "true");
  h.deny();
  await assert.rejects(h.provider(owner, trip, preferences, [{ outboundDate: "2026-11-06", returnDate: "2026-11-09" }], false, current, offers[0], true), /limit/);
  assert.equal(h.queries.length, 4);
});

test("onboarding asks only unknown/unskipped facts and accepts false/zero preferences", () => {
  assert.equal(nextOnboarding({}, [], false), "departureAirport");
  const facts = { departureAirport: "DEL", timeZone: "Asia/Kolkata", homeAirport: "LHR", budgetCents: 0, baggage: "carry_on", nonstop: false };
  assert.equal(nextOnboarding(facts, [], false), "calendar");
  assert.equal(nextOnboarding(facts, ["calendar"], false), undefined);
  assert.equal(nextOnboarding(facts, [], true), undefined);
  assert.equal(datePairs({ ...preferences, outboundDate: "2027-07-01", returnDate: "2027-07-05" }, false, now).length, 1);
});

test("3420 generated provider fixtures preserve global times, local dates, price identity and baggage uncertainty", () => {
  const codes = ["RDU", "EWR", "LAX", "HNL", "ANC", "YYZ", "MEX", "GRU", "SCL", "LHR", "CDG", "BER", "DXB", "DEL", "KTM", "NRT", "HND", "SIN", "SYD", "AKL"];
  let checked = 0;
  for (const from of codes) for (const to of codes.filter((code) => code !== from)) for (const date of ["2026-11-01", "2027-03-14", "2027-03-28"]) for (const bag of ["personal_item", "carry_on", "checked_bag"] as const) {
    const row = (origin: string, destination: string, localDate: string) => {
      const start = Temporal.PlainDate.from(localDate).toZonedDateTime({ timeZone: airportZone(origin), plainTime: "12:00" }).toInstant();
      const end = start.add({ minutes: 600 }).toZonedDateTimeISO(airportZone(destination));
      const result = option(origin, destination, `${localDate} 12:00`, `${end.toPlainDate()} ${end.toPlainTime().toString({ smallestUnit: "minute" })}`);
      result.flights[0]!.duration = 600;
      return result;
    };
    const out = row(from, to, date), back = row(to, from, Temporal.PlainDate.from(date).add({ days: 4 }).toString());
    const offer = realOffer(owner, trip, out, back, bag, now);
    assert.equal(Temporal.Instant.from(offer.outbound[0]!.arrivesAt).since(Temporal.Instant.from(offer.outbound[0]!.departsAt)).total("minutes"), 600);
    assert.equal(Temporal.Instant.from(offer.outbound[0]!.departsAt).toZonedDateTimeISO(airportZone(from)).toPlainDate().toString(), date);
    assert.equal(offer.priceHistory.length, 1); assert.equal(offer.baggageFeeCents, null);
    assert.equal(realOffer(owner, trip, out, back, bag, now).id, offer.id);
    checked++;
  }
  assert.equal(checked, 3420);
});
