import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { adjustedOffer, qualifiesPrice, quietUntil, priceNotice, reminderTime } from "./notifications.ts";
import { demoInventory, planningSchema, datePairs } from "./flights.ts";
import { reminderEvents, itineraryEvents, plannedRide } from "./journey.ts";
const preferences = planningSchema.parse({ departureAirport: "RDU", arrivalAirport: "EWR", outboundDate: "2026-10-30", returnDate: "2026-11-02", timeZone: "America/New_York", budgetCents: 30000, budgetMeaning: "round_trip_airfare_per_person", baggage: "carry_on" });
const now = "2026-10-10T18:00:00Z";
const offer = demoInventory(randomUUID(), randomUUID(), preferences, datePairs(preferences, false, now), false, now)[0]!;
test("target crossing and substantial further drops qualify; unchanged/small/rising prices stay quiet", () => {
  assert.equal(qualifiesPrice(12000, 13800, "target", 12000, 2000), true);
  assert.equal(qualifiesPrice(10000, 12000, "target", 12000, 2000), true);
  assert.equal(qualifiesPrice(11900, 12000, "target", 12000, 2000), false);
  assert.equal(qualifiesPrice(11800, 13800, "drop", null, 2000), true);
  for (const price of [13800, 14000, 13000]) assert.equal(qualifiesPrice(price, 13800, "drop", null, 2000), false);
  assert.match(priceNotice("home", 9800, 13800), /\$98 round trip \(simulated prices\).*down \$40/);
});
test("quiet hours respect local days and the daylight-saving transition", () => {
  assert.equal(quietUntil("2026-10-30T12:00:00Z", "America/New_York"), null);
  assert.equal(quietUntil("2026-10-31T02:00:00Z", "America/New_York"), "2026-10-31T12:00:00Z");
  assert.equal(quietUntil("2026-11-01T02:00:00Z", "America/New_York"), "2026-11-01T13:00:00Z");
  assert.equal(quietUntil("2026-11-01T06:30:00Z", "America/New_York"), "2026-11-01T13:00:00Z");
});
test("scenario prices change only comparable totals and versions, not real itinerary time or baggage", () => {
  const next = adjustedOffer(offer, { delta_cents: 9800 - offer.totalCents, version: 2 });
  assert.equal(next.totalCents, 9800); assert.equal(next.version, 3);
  assert.ok(next.outboundFareCents !== null && next.inboundFareCents !== null && next.baggageFeeCents !== null);
  assert.equal(next.totalCents, next.outboundFareCents + next.inboundFareCents + next.baggageFeeCents);
  for (const key of ["id", "comparisonKey", "outbound", "inbound", "baggage", "baggageFeeCents", "currency", "travelers", "cabin"] as const) assert.deepEqual(next[key], offer[key]);
  assert.equal(next.priceHistory.at(-1)!.totalCents, 9800);
  assert.throws(() => adjustedOffer(offer, { delta_cents: -offer.totalCents, version: 1 }));
});
test("calendar reminder IDs are stable, separate from flight events, and exclude private details", () => {
  const flightId = randomUUID(), ride = { id: randomUUID(), data: plannedRide(offer, "123 Secret Lane", {}) };
  const events = reminderEvents(offer, flightId, ride);
  assert.deepEqual(events, reminderEvents(offer, flightId, ride)); assert.equal(events.length, 2);
  assert.equal(Date.parse(events[0]!.start.dateTime), Date.parse(ride.data.pickupAt) - 30 * 60_000);
  assert.ok(!JSON.stringify(events).includes("Secret") && !JSON.stringify(events).includes("4242"));
  for (const event of events) { assert.deepEqual(event.reminders, { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] }); assert.ok(!itineraryEvents(offer, flightId, ride).some((item) => item.id === event.id)); }
});

test("early flights get an evening heads-up before quiet hours, preserving real flight dates across DST", () => {
  assert.equal(reminderTime("2026-11-02T11:00:00Z", 180, "America/New_York"), "2026-11-02T02:30:00Z");
  assert.equal(reminderTime("2026-11-01T11:00:00Z", 180, "America/New_York"), "2026-11-01T01:30:00Z");
  assert.equal(reminderTime("2026-10-30T18:00:00Z", 180, "America/New_York"), "2026-10-30T15:00:00Z");
});
