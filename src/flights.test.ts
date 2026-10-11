import test from "node:test";
import assert from "node:assert/strict";
import { Temporal } from "@js-temporal/polyfill";
import { offerSchema } from "./contracts.ts";
import { planningSchema, datePairs, demoInventory, rankFlights, defaultAssumptions, journey, priceContext, formatFlights, presentedFlights, briefFlightAnswer, type Preferences } from "./flights.ts";
import { localInstant, type Window } from "./schedule.ts";

const now = "2026-10-10T16:00:00Z", owner = "11111111-1111-4111-8111-111111111111", trip = "22222222-2222-4222-8222-222222222222";
const prefs = planningSchema.parse({ departureAirport: "RDU", arrivalAirport: "EWR", outboundDate: "2026-11-04", returnDate: "2026-11-08", timeZone: "America/New_York", budgetCents: 20000, budgetMeaning: "round_trip_airfare_per_person", nonstop: true, baggage: "carry_on" });
const block = (kind: Window["kind"], date: string, start: string, end: string, label = "Lecture"): Window => ({ kind, label, start: localInstant(date, start, "America/New_York"), end: localInstant(date, end, "America/New_York"), timeZone: "America/New_York", source: "schedule:test" });
const classes = [block("class", "2026-11-04", "08:00", "11:00", "Office hours class"), block("class", "2026-11-04", "11:15", "12:30", "Database Systems"), block("class", "2026-11-04", "15:35", "16:50", "Computer Organization")];
const inventory = (preferences = prefs, flexible = false, nearby = false) => demoInventory(owner, trip, preferences, datePairs(preferences, flexible, now), nearby, now);
const rank = (preferences = prefs, windows = classes, healthy = true, unknown = false, flexible = false, nearby = false) => rankFlights(inventory(preferences, flexible, nearby), preferences, windows, healthy, unknown, defaultAssumptions, now, healthy ? now : null, datePairs(preferences, flexible, now).length);

test("rough targets don't reject fares and cheapest ranks purely on verified price while respecting commitments", () => {
  const hard = rank({ ...prefs, budgetCents: 1000, budgetMode: "hard_cap" });
  assert.equal(hard.options.length, 0);
  const soft = rank({ ...prefs, budgetCents: 1000, budgetMode: "target" });
  assert.ok(soft.options.length);
  const cheapest = rank({ ...prefs, budgetCents: null, budgetMode: "cheapest", nonstop: false });
  assert.ok(cheapest.options.length);
  assert.ok(cheapest.options.every((option) => option.conflicts.length === 0));
  assert.equal(cheapest.options[0]!.offer.totalCents, Math.min(...cheapest.options.map((option) => option.offer.totalCents)));
});

test("inventory is deterministic, fictional and priced for both legs plus selected baggage", () => {
  assert.deepEqual(inventory(), inventory());
  for (const offer of inventory()) {
    assert.ok(offer.outboundFareCents !== null && offer.inboundFareCents !== null && offer.baggageFeeCents !== null);
    assert.equal(offer.totalCents, offer.outboundFareCents + offer.inboundFareCents + offer.baggageFeeCents);
    assert.equal(offer.perPersonCents, offer.totalCents); assert.equal(offer.simulated, true);
    assert.ok([...offer.outbound, ...offer.inbound].every((segment) => segment.flightNumber.startsWith("DEMO ")));
    assert.ok(offer.priceHistory.every((point) => point.simulated)); assert.equal(offer.priceHistory.at(-1)!.totalCents, offer.totalCents);
  }
  const base = inventory({ ...prefs, baggage: "personal_item" })[0]!, checked = inventory({ ...prefs, baggage: "checked_bag" })[0]!;
  assert.equal(checked.totalCents - base.totalCents, 6000);
});
test("invalid totals, missing return legs and impossible connections fail at the contract boundary", () => {
  const offer = inventory()[0]!;
  assert.throws(() => offerSchema.parse({ ...offer, totalCents: offer.totalCents + 1 }));
  assert.throws(() => offerSchema.parse({ ...offer, inbound: [] }));
  assert.throws(() => offerSchema.parse({ ...offer, outbound: [{ ...offer.outbound[0]!, departureTimeZone: "unknown" }] }));
  assert.throws(() => offerSchema.parse({ ...offer, priceHistory: [...offer.priceHistory].reverse() }));
  assert.throws(() => offerSchema.parse({ ...offer, outbound: [{ ...offer.outbound[0]!, arrivesAt: offer.outbound[0]!.departsAt }] }));
  const connection = inventory().find((offer) => offer.outbound.length === 2)!;
  assert.throws(() => offerSchema.parse({ ...connection, outbound: [connection.outbound[0]!, { ...connection.outbound[1]!, departureAirport: "BOS" }] }));
});
test("cheap flights are rejected for commitments during the full absence and airport journey", () => {
  const result = rank(); assert.equal(result.status, "options"); assert.equal(result.options[0]!.offer.totalCents, 18800);
  assert.ok(result.options.every((option) => !option.conflicts.length));
  const cheap = result.rejected.find((item) => item.totalCents === 11800)!; assert.equal(cheap.reason, "schedule_conflict"); assert.ok(cheap.conflicts.includes("Database Systems"));
  const buffer = rank(prefs, [block("busy", "2026-11-04", "17:00", "17:45", "Work shift")]);
  assert.equal(buffer.options.length, 0);
  const boundary = rank(prefs, [block("class", "2026-11-04", "16:00", "17:25")]); assert.ok(boundary.options.length);
});
test("class permission is trip-specific and never permits missing other busy commitments", () => {
  const permitted = rank({ ...prefs, allowMissedCommitments: true });
  assert.equal(permitted.options[0]!.offer.totalCents, 11800); assert.ok(permitted.options[0]!.conflicts.includes("Database Systems"));
  assert.equal(rank({ ...prefs, allowMissedCommitments: true }, [block("busy", "2026-11-05", "09:00", "10:00", "Work")]).options.length, 0);
});
test("revoked or unconfirmed calendar data never becomes an empty free schedule", () => {
  assert.equal(rank(prefs, [], false, true).status, "schedule_unknown");
  assert.equal(rank(prefs, [], false, false).status, "schedule_unknown");
  assert.equal(rank(prefs, [], true, true).options.length, 0);
  const declared = { ...block("available", "2026-11-04", "00:00", "23:59"), end: localInstant("2026-11-09", "00:00", "America/New_York") };
  assert.ok(rank(prefs, [declared], false, false).options.length);
  assert.equal(rank(prefs, [declared], false, true).options.length, 0);
});
test("changing budget and baggage changes feasible results without changing quoted totals", () => {
  assert.equal(rank({ ...prefs, budgetCents: 10000 }).status, "no_results");
  assert.ok(rank({ ...prefs, budgetCents: 19000 }).options.length);
  assert.equal(rank({ ...prefs, baggage: "checked_bag" }).options.length, 0);
});
test("layovers require the stated savings against comparable feasible nonstop itineraries", () => {
  const allowed = rank({ ...prefs, nonstop: false, minLayoverSavingsCents: 8000 });
  assert.equal(allowed.options[0]!.offer.outbound.length, 2); assert.equal(allowed.options[0]!.offer.totalCents, 9800);
  assert.ok(rank({ ...prefs, nonstop: false, minLayoverSavingsCents: 10000 }).options.every((option) => option.offer.outbound.length === 1));
  const summerClock = { ...prefs, outboundDate: "2026-10-28", returnDate: "2026-11-01", nonstop: false, minLayoverSavingsCents: 8000 };
  assert.ok(rank(summerClock, [block("class", "2026-10-28", "15:35", "16:50")]).options.some((option) => option.offer.outbound.length === 2));
});
test("a Monday return respects the Monday class and offers an early return if it fits", () => {
  const monday = { ...prefs, returnDate: "2026-11-09" };
  const result = rank(monday, [...classes, block("class", "2026-11-09", "09:00", "10:00", "Monday class")]);
  assert.ok(result.options.length); assert.equal(Temporal.Instant.from(result.options[0]!.offer.inbound[0]!.departsAt).toZonedDateTimeISO("America/New_York").hour, 6);
  assert.ok(result.rejected.some((item) => item.conflicts.includes("Monday class")));
});
test("flexible searches stay bounded and a requested nearby-airport alternative is visible", () => {
  const pairs = datePairs(prefs, true, now); assert.equal(pairs.length, 6);
  const result = rank({ ...prefs, budgetCents: 40000 }, classes, true, false, true, true);
  assert.ok(result.options.length <= 3); assert.equal(result.datePairs, 6);
  assert.ok(result.options.some((option) => option.offer.outbound.at(-1)!.arrivalAirport === "JFK"));
  assert.equal(new Set(inventory(prefs, true, true).map((offer) => offer.outbound.at(-1)!.arrivalAirport)).size, 2);
});
test("departure limits and usable time at home are enforced with local times across DST", () => {
  assert.equal(rank({ ...prefs, latestDeparture: "18:00" }).options.length, 0);
  const data: Preferences = { ...prefs, outboundDate: "2026-10-30", returnDate: "2026-11-02" };
  const offer = inventory(data).find((offer) => offer.outbound[0]!.departsAt.endsWith("00:00:00Z")) || inventory(data)[2]!;
  const travel = journey(offer, defaultAssumptions); assert.ok(travel.homeHours > 24);
  assert.equal(Temporal.Instant.from(offer.outbound[0]!.departsAt).toZonedDateTimeISO("America/New_York").hour, 20);
  const constrained = rankFlights(inventory(), prefs, [], true, false, { ...defaultAssumptions, minimumHomeHours: 168 }, now, now, 1);
  assert.equal(constrained.options.length, 0);
});
test("history is tied to each exact itinerary and unsupported routes and bad dates are honest", () => {
  const a = inventory()[0]!, b = inventory({ ...prefs, returnDate: "2026-11-09" })[0]!;
  assert.notEqual(priceContext(a).comparisonKey, priceContext(b).comparisonKey);
  const shortHistory = offerSchema.parse({ ...a, priceHistory: [a.priceHistory[0]!, a.priceHistory[1]!, a.priceHistory.at(-1)!] });
  assert.equal(priceContext(shortHistory).medianCents, Math.round((a.priceHistory[0]!.totalCents + a.priceHistory[1]!.totalCents) / 2));
  assert.equal(rank({ ...prefs, arrivalAirport: "LAX" }).status, "unsupported_route");
  assert.throws(() => datePairs({ ...prefs, returnDate: prefs.outboundDate }, false, now));
  assert.throws(() => datePairs({ ...prefs, outboundDate: "2026-01-01" }, false, now));
  assert.match(formatFlights(rank(), "Home"), /simulated prices/i);
  assert.match(formatFlights(rank(prefs, [], false, true), "Home"), /can't verify your schedule/);
});

test("default search presents one unambiguous recommendation; explicit alternatives preserve choices", () => {
  const result = rank({ ...prefs, outboundDate: "2026-10-30", returnDate: "2026-11-01", budgetCents: 25000 }, []);
  const displayed = presentedFlights(result, "search flights home");
  assert.equal(displayed.options.length, 1); assert.equal(result.options.length, 3);
  assert.equal(presentedFlights(result, "show me more options").options.length, 3);
  const nearby = presentedFlights(rank({ ...prefs, outboundDate: "2026-10-30", returnDate: "2026-11-01", budgetCents: 25000 }, [], true, false, false, true), "try nearby airports", true);
  assert.equal(nearby.options.length, 2);
  assert.match(formatFlights(nearby, "Home"), /JFK/); assert.match(formatFlights(nearby, "Home"), /75min home drive/);
  assert.match(formatFlights(nearby, "Home"), /same flight times/);
  const text = formatFlights(displayed, "weekend home demo");
  assert.ok(text.split(/\s+/).length < 45);
  for (const value of ["$138 round trip (simulated prices)", "RDU ↔ EWR", "nonstop", "Oct 30", "1pm EDT", "Nov 1", "6pm EST"]) assert.ok(text.includes(value), value);
  assert.doesNotMatch(text, /weekend home demo|Want to|travel buffers|2\./);
  const all = formatFlights(result, "Home"); assert.ok(all.split(/\s+/).length < 120);
  assert.match(all, /1 ·/); assert.match(all, /2 ·/); assert.match(all, /3 ·/);
  assert.match(formatFlights(rank({ ...prefs, allowMissedCommitments: true }), "Home"), /with your permission/);
  assert.doesNotMatch(formatFlights(rank(), "Home"), /overlaps|other commitments/);
});

test("follow-ups state changed legs and price without repeating unchanged itinerary", () => {
  const previous = presentedFlights(rank({ ...prefs, outboundDate: "2026-10-30", returnDate: "2026-11-01" }, []), "search flights");
  const changed = presentedFlights(rank({ ...prefs, outboundDate: "2026-10-30", returnDate: "2026-11-02" }, []), "return Monday");
  const text = formatFlights(changed, "Home", previous);
  assert.match(text, /back Nov 2/); assert.match(text, /round trip \(simulated prices\)/);
  assert.doesNotMatch(text, /RDU|out |Out:|i'd take/);
  const unchanged = formatFlights(changed, "Home", changed);
  assert.match(unchanged, /same flight still looks best/); assert.ok(unchanged.split(/\s+/).length < 25);
  assert.doesNotMatch(unchanged, /Nov 2|Leave|back Mon/);
});

test("compact flight times retain arrival dates and both zones when a leg crosses midnight or DST", () => {
  const result = rank(prefs, []), option = result.options[0]!;
  option.offer.outbound = [{ ...option.offer.outbound[0]!, departsAt: "2026-10-30T23:00:00-04:00", arrivesAt: "2026-10-31T00:40:00-04:00" }];
  assert.match(formatFlights(result, "Home"), /Oct 30 at 11pm EDT \(lands Oct 31 at 12:40am EDT\)/);
  option.offer.outbound = [{ ...option.offer.outbound[0]!, departsAt: "2026-11-01T00:30:00-04:00", arrivesAt: "2026-11-01T02:10:00-05:00" }];
  assert.match(formatFlights(result, "Home"), /12:30am EDT \(lands Nov 1 at 2:10am EST\)/);
});


test("simple flight questions get one-word answers only when the offer proves them", () => {
  const offer = inventory()[0]!;
  for (const question of ["does that include a carry on", "Does my booked flight include a carry-on?", "carryon included?", "comes with a carry-on?"]) assert.equal(briefFlightAnswer(offer, question), "yup");
  assert.equal(briefFlightAnswer(offer, "is that nonstop?"), "yup");
  assert.equal(briefFlightAnswer(inventory().find((item) => item.outbound.length === 2)!, "is that nonstop?"), "nope");
  assert.equal(briefFlightAnswer(inventory({ ...prefs, baggage: "personal_item" })[0]!, "does that include a carry-on?"), "nope");
  for (const question of ["does that include a carry-on and a checked bag?", "why does it include carry-on?", "what does a carry-on cost?", "doesn't that include a carry-on?", "doesn’t that include a carry-on?", "change it to include a carry-on", "book it with a carry-on"]) assert.equal(briefFlightAnswer(offer, question), null);
  assert.equal(briefFlightAnswer(inventory({ ...prefs, baggage: "checked_bag" })[0]!, "does that include a carry-on?"), null);
});
