import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { demoInventory, planningSchema, datePairs } from "./flights.ts";
import { itineraryEvents, plannedRide, rideReview } from "./journey.ts";
import { offerSchema } from "./contracts.ts";

function offer() {
  const preferences = planningSchema.parse({ departureAirport: "RDU", arrivalAirport: "EWR", outboundDate: "2026-10-30", returnDate: "2026-11-02", timeZone: "America/New_York", budgetCents: 30000, budgetMeaning: "round_trip_airfare_per_person", baggage: "carry_on" });
  return demoInventory(randomUUID(), randomUUID(), preferences, datePairs(preferences, false, "2026-10-10T18:00:00Z"), false, "2026-10-10T18:00:00Z")[1]!;
}
test("pickup derives from the booked departure and original buffers across a day boundary", () => {
  const flight = offer();
  const first = flight.outbound[0]!;
  first.departsAt = "2026-11-01T06:30:00Z"; first.arrivesAt = "2026-11-01T08:10:00Z";
  const ride = plannedRide(offerSchema.parse(flight), "123 Demo Lane, Chapel Hill", { originDriveMinutes: 35, airportBufferMinutes: 120 });
  assert.equal(ride.pickupAt, "2026-11-01T03:55:00Z");
  assert.equal(Temporal.Instant.from(ride.pickupAt).toZonedDateTimeISO(ride.timeZone).toPlainDate().toString(), "2026-10-31");
  assert.equal(ride.airportAt, "2026-11-01T04:30:00Z");
  const text = rideReview(randomUUID(), ride);
  assert.match(text, /Oct 31, 2026/); assert.match(text, /EDT/); assert.match(text, /\$32\.00/); assert.match(text, /no real ride, dispatch or charge/);
  assert.throws(() => plannedRide(flight, "abc", {}));
  assert.throws(() => plannedRide(flight, "123 Demo Lane", { originDriveMinutes: 0 }));
});
test("calendar IDs survive reviews, preserve both leg zones and never include private pickup/payment/reference", () => {
  const flight = offer(), flightId = randomUUID(), rideId = randomUUID();
  const ride = plannedRide(flight, "123 Secret Lane", {}), events = itineraryEvents(flight, flightId, { id: rideId, data: ride });
  assert.equal(events.length, 3);
  assert.deepEqual(events, itineraryEvents(flight, flightId, { id: rideId, data: ride }));
  assert.deepEqual(events.slice(1), itineraryEvents(flight, flightId));
  assert.equal(new Set(events.map((event) => event.id)).size, 3);
  const raw = JSON.stringify(events);
  assert.ok(!raw.includes(ride.pickup) && !raw.includes(ride.paymentLabel));
  for (const event of events) { assert.ok(event.summary.startsWith("[simulated]")); assert.equal(event.visibility, "private"); assert.equal(event.transparency, "transparent"); assert.deepEqual(event.reminders, { useDefault: false }); assert.ok(!("attendees" in event)); assert.match(event.id, /^[a-v0-9]+$/); }
  assert.match(rideReview(rideId, ride), /EDT/);
  assert.equal(events[2]!.start.timeZone, flight.inbound[0]!.departureTimeZone);
  assert.notEqual(events[1]!.id, itineraryEvents({ ...flight, ownerId: randomUUID() }, flightId)[0]!.id);
});


test("real flight quotes support simulated pickups without claiming a real dispatch", () => {
  const seed = offer();
  const flight = offerSchema.parse({ ...seed, simulated: false, inventoryVersion: "serpapi-v1", outboundFareCents: null, inboundFareCents: null, baggageFeeCents: null, priceHistory: seed.priceHistory.map((point) => ({ ...point, simulated: false })) });
  const ride = plannedRide(flight, "123 Airport Lane", {});
  assert.equal(ride.simulated, true);
  assert.equal(ride.airport, flight.outbound[0]!.departureAirport);
  assert.equal(ride.totalCents, 3200);
  assert.match(rideReview(randomUUID(), ride), /no real ride, dispatch or charge/);
});
