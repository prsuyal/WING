import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import {
  createSharingStore,
  hashShareToken,
  projectPlanningSummary,
  shareTokenPattern,
} from "./sharing.ts";
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
    { name: fact("Aarnav"), homeAirport: fact("JFK"), homeCity: fact("secret") },
  );
  assert.deepEqual(summary, {
    displayName: "Aarnav",
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
        if (url.pathname.endsWith("wing_trips"))
          return Response.json({
            facts: { departureAirport: fact("RDU"), budgetCents: fact(25000) },
            updated_at: "2026-10-10T00:00:00Z",
            pickup_override: "private",
          });
        return Response.json({
          facts: { name: fact("Aarnav"), school: fact("private") },
        });
      },
    },
  });
  const result = await createSharingStore(
    client,
    "http://localhost:3000",
  ).summary(token);
  assert.equal(result?.displayName, "Aarnav");
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
