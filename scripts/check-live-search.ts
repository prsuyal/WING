import assert from "node:assert/strict";
import { loadEnvFile } from "node:process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createLiveFlights } from "../src/live-flights.ts";
import { planningSchema } from "../src/flights.ts";
loadEnvFile();
assert.ok(process.env.SERPAPI_API_KEY?.trim(), "Set SERPAPI_API_KEY in .env");
const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const search = createLiveFlights(process.env.SERPAPI_API_KEY!, client);
for (const [departureAirport, arrivalAirport, returnDate] of [["RDU", "EWR", "2026-11-23"], ["JFK", "LHR", "2026-11-25"]]) {
  const preferences = planningSchema.parse({ departureAirport, arrivalAirport, outboundDate: "2026-11-20", returnDate, timeZone: "America/New_York", budgetCents: 200000, budgetMeaning: "round_trip_airfare_per_person", nonstop: true, baggage: "carry_on" });
  const offers = await search(randomUUID(), randomUUID(), preferences, [{ outboundDate: preferences.outboundDate, returnDate: preferences.returnDate }], false, new Date().toISOString());
  assert.ok(offers.length, `${departureAirport}-${arrivalAirport}: no verified real round trips returned`);
  for (const offer of offers) { assert.equal(offer.simulated, false); assert.equal(offer.outbound[0]!.departureAirport, departureAirport); assert.equal(offer.outbound.at(-1)!.arrivalAirport, arrivalAirport); assert.equal(offer.outboundFareCents, null); }
  console.log(JSON.stringify({ route: `${departureAirport}-${arrivalAirport}`, verifiedRoundTrips: offers.length, prices: offers.slice(0, 3).map((offer) => offer.totalCents / 100), timeZones: [offers[0]!.outbound[0]!.departureTimeZone, offers[0]!.outbound.at(-1)!.arrivalTimeZone], realSearch: true, bookingAttempted: false }));
}
