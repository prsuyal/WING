import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "../app/api/trips/[token]/route.ts";

const token = "a".repeat(43);
const summary = {
  displayName: "Aarnav",
  status: "planning",
  departureAirport: "RDU",
  arrivalAirport: "EWR",
  outboundDate: "2026-11-06",
  returnDate: null,
  updatedAt: "2026-10-10T00:00:00Z",
  simulated: true,
};
const read = (value = token) =>
  GET(new Request(`http://localhost:3000/api/trips/${value}`), {
    params: Promise.resolve({ token: value }),
  });

test("website proxy validates tokens without contacting the backend", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("Unexpected request");
  });
  assert.equal((await read("123456")).status, 404);
  assert.equal(calls, 0);
});

test("website proxy fetches only the public endpoint and forbids caching and referrers", async (t) => {
  let destination = "";
  let options: RequestInit | undefined;
  t.mock.method(globalThis, "fetch", async (url: URL, init: RequestInit) => {
    destination = url.href;
    options = init;
    return Response.json(summary);
  });
  const response = await read();
  assert.deepEqual(await response.json(), summary);
  assert.equal(new URL(destination).pathname, `/public/trips/${token}`);
  assert.equal(options?.cache, "no-store");
  assert.equal(options?.redirect, "error");
  assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("x-robots-tag")!, /noindex/);
});

test("website proxy fails closed if private or malformed fields reach the backend response", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      ...summary,
      address: "123 Main Street",
      payment: "private",
    }),
  );
  const response = await read();
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes("Main Street"), false);
});

test("missing links stay unavailable and transient backend failures expose no internals", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: "missing" }, { status: 404 }),
  );
  assert.equal((await read()).status, 404);
  mock.mock.mockImplementation(async () => {
    throw new Error("secret connection details");
  });
  const response = await read();
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes("secret"), false);
});


test("website proxy accepts a booked itinerary but rejects private nested ride data", async (t) => {
  const leg = { flightNumber: "UA 123", departureAirport: "RDU", arrivalAirport: "EWR", departureName: "Raleigh-Durham", arrivalName: "Newark Liberty", departureCity: "Raleigh", arrivalCity: "Newark", departsAt: "2026-11-06T18:00:00Z", arrivesAt: "2026-11-06T19:40:00Z", departureTimeZone: "America/New_York", arrivalTimeZone: "America/New_York" };
  const booked = { ...summary, status: "booked", booking: { airline: "United", cabin: "economy", baggage: "carry-on included", outbound: [leg], inbound: [{ ...leg, departureAirport: "EWR", arrivalAirport: "RDU", departsAt: "2026-11-09T18:00:00Z", arrivesAt: "2026-11-09T19:40:00Z" }], simulated: true }, ride: { provider: "Uber", status: "reserved", pickupLabel: "Trip pickup", airport: "RDU", pickupAt: "2026-11-06T15:25:00Z", airportAt: "2026-11-06T16:00:00Z", timeZone: "America/New_York", simulated: true } };
  const mock = t.mock.method(globalThis, "fetch", async () => Response.json(booked));
  assert.deepEqual(await (await read()).json(), booked);
  mock.mock.mockImplementation(async () => Response.json({ ...booked, ride: { ...booked.ride, pickup: "123 Secret Lane" } }));
  assert.equal((await read()).status, 503);
  mock.mock.mockImplementation(async () => Response.json({ ...booked, booking: undefined }));
  assert.equal((await read()).status, 503);
});
