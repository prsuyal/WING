import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import {
  createSharingStore,
  hashShareToken,
  projectPlanningSummary,
  shareTokenPattern,
} from "./sharing.ts";
import { demoInventory, planningSchema, datePairs } from "./flights.ts";
import { plannedRide } from "./journey.ts";
import type { Actor } from "./contracts.ts";

const owner = "00000000-0000-4000-8000-000000000001";
const trip = "00000000-0000-4000-8000-000000000002";
const source = "00000000-0000-4000-8000-000000000003";
const actor: Actor = {
  userId: owner,
  sourceMessageId: source,
  namespace: "test",
  sourceText: "share my trip",
};
const token = "a".repeat(43);
const fact = (value: unknown) => ({
  confirmed: {
    value,
    sourceMessageId: source,
    updatedAt: "2026-10-10T00:00:00Z",
  },
});

test("public projection contains only confirmed trip facts and omits private fields", () => {
  const summary = projectPlanningSummary(
    {
      facts: {
        departureAirport: fact("RDU"),
        arrivalAirport: fact("EWR"),
        outboundDate: fact("2026-11-06"),
        returnDate: {
          tentative: {
            value: "2026-11-09",
            sourceMessageId: source,
            updatedAt: "2026-10-10T00:00:00Z",
          },
        },
        budgetCents: fact(20000),
        address: fact("123 Main Street"),
        schedule: fact("Friday class"),
      },
      updated_at: "2026-10-10T01:00:00+00:00",
    },
    { name: fact("Alex"), homeAirport: fact("JFK"), homeCity: fact("secret") },
  );
  assert.deepEqual(summary, {
    displayName: "Alex",
    status: "planning",
    departureAirport: "RDU",
    arrivalAirport: "EWR",
    outboundDate: "2026-11-06",
    returnDate: null,
    updatedAt: "2026-10-10T01:00:00+00:00",
    simulated: true,
  });
  assert.equal(JSON.stringify(summary).includes("Main Street"), false);
  const blank = projectPlanningSummary(
    { facts: {}, updated_at: summary.updatedAt },
    { homeAirport: fact("JFK"), name: fact("123 Main Street") },
  );
  assert.equal(blank.arrivalAirport, null);
  assert.equal(blank.displayName, "Your traveler");
});

test("invalid tokens and absent consent never reach persistence", async () => {
  let requests = 0;
  const client = createClient("https://example.supabase.co", "test-key", {
    global: {
      fetch: async () => {
        requests++;
        throw new Error("Unexpected request");
      },
    },
  });
  const sharing = createSharingStore(client, "http://localhost:3000");
  for (const invalid of [
    "123456",
    "",
    "../health",
    "a".repeat(42),
    "a".repeat(44),
  ])
    assert.equal(await sharing.summary(invalid), null);
  await assert.rejects(
    sharing.create({ ...actor, sourceText: "tell me about this trip" }, trip),
    /Ask the traveler/,
  );
  await assert.rejects(
    sharing.create({ ...actor, sourceText: "do not share my trip" }, trip),
    /Ask the traveler/,
  );
  await assert.rejects(sharing.revoke(actor, trip), /Explicit request/);
  assert.equal(requests, 0);
  assert.throws(() => createSharingStore(client, "http://wing.tech"), /HTTPS/);
});

test("creation verifies ownership and stores a hash rather than the bearer token", async () => {
  let stored: Record<string, unknown> = {};
  const calls: URL[] = [];
  const client = createClient("https://example.supabase.co", "test-key", {
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        calls.push(url);
        if (init?.method === "POST") {
          stored = JSON.parse(String(init.body));
          return new Response(null, { status: 201 });
        }
        return Response.json({
          id: url.pathname.endsWith("wing_trips") ? trip : source,
        });
      },
    },
  });
  const result = await createSharingStore(
    client,
    "http://localhost:3000",
  ).create(actor, trip);
  const raw = new URL(result.url).pathname.slice(1);
  assert.match(raw, shareTokenPattern);
  assert.equal(stored.token_hash, hashShareToken(raw));
  assert.equal(stored.owner_id, owner);
  assert.equal(stored.trip_id, trip);
  assert.equal(JSON.stringify(stored).includes(raw), false);
  assert.ok(Date.parse(result.expiresAt) > Date.now() + 6 * 86400000);
  assert.ok(
    calls
      .filter(
        (url) =>
          url.pathname.endsWith("wing_trips") ||
          url.pathname.endsWith("wing_messages"),
      )
      .every((url) => url.searchParams.get("owner_id") === `eq.${owner}`),
  );
  const natural = await createSharingStore(client, "https://wing-hacknc.vercel.app").create({
    ...actor, sourceText: "can i send this to my parents?", interpret: async (operation) => {
      assert.match(operation, /read-only itinerary link/);
      return true;
    },
  }, trip);
  assert.equal(new URL(natural.url).origin, "https://wing-hacknc.vercel.app");
  const before = calls.length;
  await assert.rejects(createSharingStore(client, "https://wing-hacknc.vercel.app").create({
    ...actor, sourceText: "don't let my parents see it", interpret: async () => false,
  }, trip), /Ask the traveler/);
  assert.equal(calls.length, before);
});

test("another sender cannot create or revoke a link for a trip they do not own", async () => {
  let writes = 0;
  const client = createClient("https://example.supabase.co", "test-key", {
    global: {
      fetch: async (input, init) => {
        if (init?.method !== "GET") writes++;
        return Response.json(
          new URL(String(input)).pathname.endsWith("wing_trips")
            ? null
            : { id: source },
        );
      },
    },
  });
  const sharing = createSharingStore(client, "http://localhost:3000");
  await assert.rejects(
    sharing.create(actor, trip),
    /unavailable to this sender/,
  );
  await assert.rejects(
    sharing.revoke({ ...actor, sourceText: "revoke my trip links" }, trip),
    /unavailable to this sender/,
  );
  assert.equal(writes, 0);
});

test("summary lookup enforces expiry and revocation and scopes records to their owner", async () => {
  const calls: URL[] = [];
  const client = createClient("https://example.supabase.co", "test-key", {
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        calls.push(url);
        if (url.pathname.endsWith("wing_trip_links"))
          return Response.json({ owner_id: owner, trip_id: trip });
        if (url.pathname.endsWith("wing_flight_reservations")) return Response.json(null);
        if (url.pathname.endsWith("wing_trips"))
          return Response.json({
            facts: { departureAirport: fact("RDU"), budgetCents: fact(25000) },
            updated_at: "2026-10-10T00:00:00Z",
            pickup_override: "private",
          });
        return Response.json({
          facts: { name: fact("Alex"), school: fact("private") },
        });
      },
    },
  });
  const result = await createSharingStore(
    client,
    "http://localhost:3000",
  ).summary(token);
  assert.equal(result?.displayName, "Alex");
  assert.equal(Object.hasOwn(result!, "pickup_override"), false);
  assert.equal(
    calls[0]!.searchParams.get("token_hash"),
    `eq.${hashShareToken(token)}`,
  );
  assert.equal(calls[0]!.searchParams.get("revoked_at"), "is.null");
  assert.match(calls[0]!.searchParams.get("expires_at")!, /^gt\./);
  assert.ok(
    calls
      .slice(1)
      .every((url) => url.searchParams.get("owner_id") === `eq.${owner}`),
  );
  const missing = createClient("https://example.supabase.co", "test-key", {
    global: { fetch: async () => Response.json(null) },
  });
  assert.equal(
    await createSharingStore(missing, "http://localhost:3000").summary(token),
    null,
  );
});


test("shared booked itinerary uses verified flights and confirmed ride while omitting private records", async () => {
  const prefs = planningSchema.parse({ departureAirport: "RDU", arrivalAirport: "EWR", outboundDate: "2026-11-06", returnDate: "2026-11-09", timeZone: "America/New_York", baggage: "carry_on" });
  const offer = demoInventory(owner, trip, prefs, datePairs(prefs, false, "2026-10-11T00:00:00Z"), false, "2026-10-11T00:00:00Z")[0]!;
  const flightId = "00000000-0000-4000-8000-000000000004";
  const ride = plannedRide(offer, "123 Private Street", {}, 1, "Private payment");
  let withRide = true, verified = true;
  const calls: URL[] = [];
  const client = createClient("https://example.supabase.co", "unit-key", { global: { fetch: async (input) => {
    const url = new URL(String(input)); calls.push(url);
    assert.equal(url.searchParams.get("owner_id"), url.pathname.endsWith("wing_trip_links") ? null : `eq.${owner}`);
    switch (url.pathname.split("/").at(-1)) {
      case "wing_trip_links": return Response.json({ owner_id: owner, trip_id: trip });
      case "wing_trips": return Response.json({ facts: { departureAirport: fact("JFK") }, updated_at: "2026-10-10T00:00:00Z", pickup_override: "Private Street" });
      case "wing_profiles": return Response.json({ facts: { name: fact("Alex") } });
      case "wing_flight_reservations": return Response.json({ action_id: flightId, offer, created_at: "2026-10-11T01:00:00Z", reference: "PRIVATE-CONFIRMATION" });
      case "wing_flight_actions": return Response.json({ status: verified ? "confirmed" : "review", offer });
      case "wing_journey_actions":
        assert.equal(url.searchParams.get("status"), "eq.confirmed");
        assert.equal(url.searchParams.get("kind"), "eq.ride");
        assert.equal(url.searchParams.get("flight_action_id"), `eq.${flightId}`);
        return Response.json(withRide ? { payload: ride, created_at: "2026-10-11T02:00:00Z" } : null);
      default: throw new Error("Unexpected query");
    }
  } } });
  const sharing = createSharingStore(client, "https://wing.example");
  const summary = (await sharing.summary(token))!;
  assert.equal(summary.status, "booked");
  assert.equal(summary.departureAirport, "RDU");
  assert.equal(summary.booking!.outbound[0]!.flightNumber, offer.outbound[0]!.flightNumber);
  assert.equal(summary.booking!.inbound[0]!.arrivesAt, offer.inbound[0]!.arrivesAt);
  assert.equal(summary.ride!.pickupAt, ride.pickupAt);
  assert.equal(summary.ride!.provider, "Uber");
  assert.equal(summary.updatedAt, "2026-10-11T02:00:00Z");
  for (const secret of [owner, trip, flightId, "Private Street", "Private payment", "PRIVATE-CONFIRMATION", "totalCents", "sourceMessageId"]) assert.equal(JSON.stringify(summary).includes(secret), false);
  withRide = false;
  assert.equal((await sharing.summary(token))!.ride, undefined);
  verified = false;
  await assert.rejects(sharing.summary(token), /Booking not verified/);
});
