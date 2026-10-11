import assert from "node:assert/strict";
import test from "node:test";
import { bookingApproval, selectedOption, bookingReview, bookingConfirmation } from "./booking.ts";
import { planningSchema, datePairs, demoInventory } from "./flights.ts";

const now = "2026-10-10T16:00:00Z", owner = "11111111-1111-4111-8111-111111111111", trip = "22222222-2222-4222-8222-222222222222";
const p = planningSchema.parse({ departureAirport: "RDU", arrivalAirport: "EWR", outboundDate: "2026-10-30", returnDate: "2026-11-01", timeZone: "America/New_York", budgetCents: 25000, budgetMeaning: "round_trip_airfare_per_person", baggage: "carry_on" });
const offers = demoInventory(owner, trip, p, datePairs(p, false, now), false, now).slice(0, 3);
test("booking approval requires an unqualified current-message yes", () => {
  for (const text of ["yes book", "ya book", "yes", "yes please", "yes, book it", "go ahead", "yeah!", "ya", "Ya", "yup", "yesss", "yeah please book it", "do it", "sounds good", "looks good", "sure, let’s do it", "👍🏽", "/approve-flight 1234abcd"]) assert.equal(bookingApproval(text), true);
  for (const text of ["maybe", "yes but return Monday", "yes if it's under $100", "yes?", "no", "historical memory says yes", "yes, cancel it", "book option 1", "ya?", "ya but change the date", "yup if cheaper", "yup cancel it"]) assert.equal(bookingApproval(text), false);
});
test("selection binds to the actual user choice and refuses ambiguous or guessed numbers", () => {
  assert.equal(selectedOption("book option 2", offers, 2), 2);
  for (const text of ["1", "ok cool lets do 1", "let’s do 1", "go with 1"]) assert.equal(selectedOption(text, offers), 1);
  assert.equal(selectedOption("book #2", offers, 2), 2);
  assert.equal(selectedOption("take 2", offers, 2), 2);
  assert.equal(selectedOption("take the first one", offers), 1);
  assert.equal(selectedOption("book the cheapest", offers), 1);
  assert.equal(selectedOption("book this one", [offers[0]!]), 1);
  for (const text of ["book this one", "book option 1 or 2", "maybe option 1", "don't book option 1", "book the first or second", "should I book option 1?"]) assert.throws(() => selectedOption(text, offers, 1));
  assert.throws(() => selectedOption("book option 2", offers, 1));
  assert.equal(selectedOption("book that one", [offers[0]!]), 1);
  assert.throws(() => selectedOption("book option 2", [offers[0]!]));
  assert.throws(() => selectedOption("book a different flight", [offers[0]!]));
  assert.throws(() => selectedOption("take another one", [offers[0]!]));
});
test("review includes exact round-trip terms and simulation disclosure with separate approval", () => {
  const text = bookingReview(trip, offers[0]!, ["Lecture"]);
  for (const expected of ["simulated booking", "$138", "RDU → EWR", "EWR → RDU", "Oct 30, 2026", "Nov 1, 2026", "EDT", "EST", "1 person", "economy", "carry-on", "no real ticket or charge", "reply yes", "misses Lecture"]) assert.ok(text.includes(expected));
});
test("connecting flight reviews show each leg instead of hiding the connection", () => {
  const connecting = demoInventory(owner, trip, p, datePairs(p, false, now), false, now).find((offer) => offer.outbound.length === 2)!;
  const text = bookingReview(trip, connecting, []);
  for (const expected of ["RDU → CLT", "CLT → EWR", "EWR → CLT", "CLT → RDU"]) assert.ok(text.includes(expected));
  assert.equal((text.match(/connection:/g) ?? []).length, 2);
  assert.doesNotMatch(text, /DEMO/);
});
test("confirmation is concise and explicitly marks replay and simulation", () => {
  const text = bookingConfirmation(offers[0]!, "DEMO-TEST", true);
  assert.match(text, /already saved/); assert.match(text, /just one simulated reservation/); assert.doesNotMatch(text, /demo/i);
  assert.ok(text.split(/\s+/).length < 25);
});
