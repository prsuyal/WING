import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { offerSchema, understands } from "./contracts.ts";
import { rideSchema } from "./journey.ts";
import { airports } from "./airports.ts";
import type { Actor } from "./contracts.ts";
import { confirmedFacts, type Facts } from "./profile.ts";

import {
  shareTokenPattern,
  publicSummarySchema,
  type PublicSummary,
} from "./public-summary.ts";
export { shareTokenPattern } from "./public-summary.ts";
export const hashShareToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

// Phase 1 projection: use explicit trip facts only. General profile defaults are
// preferences, not a confirmed itinerary. Never spread a database record here.
export function projectPlanningSummary(
  trip: { facts: Facts; updated_at: string },
  profile: Facts,
): PublicSummary {
  const facts = confirmedFacts(trip.facts);
  const name = confirmedFacts(profile).name;
  const text = z
    .string()
    .max(80)
    .regex(/^[\p{L}\p{M} '\-]+$/u)
    .safeParse(name);
  const airport = (value: unknown) => {
    const result = z
      .string()
      .regex(/^[A-Z]{3}$/)
      .safeParse(value);
    return result.success ? result.data : null;
  };
  const date = (value: unknown) => {
    const result = z.iso.date().safeParse(value);
    return result.success ? result.data : null;
  };
  return publicSummarySchema.parse({
    displayName: text.success ? text.data : "Your traveler",
    status: "planning",
    departureAirport: airport(facts.departureAirport),
    arrivalAirport: airport(facts.arrivalAirport),
    outboundDate: date(facts.outboundDate),
    returnDate: date(facts.returnDate),
    updatedAt: trip.updated_at,
    simulated: true,
  });
}

export function createSharingStore(client: SupabaseClient, websiteUrl: string) {
  const origin = new URL(websiteUrl);
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error("WING_WEBSITE_URL must be a website origin");
  if (
    origin.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
  )
    throw new Error("Share links require HTTPS outside localhost");
  async function ownedTrip(actor: Actor, tripId: string) {
    const [trip, source] = await Promise.all([
      client
        .from("wing_trips")
        .select("id")
        .eq("owner_id", actor.userId)
        .eq("id", z.uuid().parse(tripId))
        .maybeSingle(),
      client
        .from("wing_messages")
        .select("id")
        .eq("owner_id", actor.userId)
        .eq("id", actor.sourceMessageId)
        .eq("direction", "inbound")
        .maybeSingle(),
    ]);
    if (trip.error || source.error || !trip.data || !source.data)
      throw new Error("Trip unavailable to this sender");
  }
  return {
    async create(actor: Actor, tripId: string) {
      if (!await understands(actor, "Generate a read-only itinerary link for this trip so the traveler can share it with family or someone else. Accept natural requests such as 'can I send this to my parents', 'let my mom see the itinerary', or 'give me something to send home'; no exact keyword is required. This creates a link for the traveler, not a message to anyone else. Reject negation, hypothetical discussion or unrelated requests.",
        /\b(share|link)\b/i.test(actor.sourceText) && !/\b(don't|do not|never|not|no)\b/i.test(actor.sourceText)))
        throw new Error("Ask the traveler before creating a share link");
      await ownedTrip(actor, tripId);
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const { error } = await client
        .from("wing_trip_links")
        .insert({
          owner_id: actor.userId,
          trip_id: tripId,
          source_message_id: actor.sourceMessageId,
          token_hash: hashShareToken(token),
          expires_at: expiresAt,
        });
      if (error)
        throw new Error(
          "Trip sharing unavailable; apply the website sharing migration",
        );
      return {
        url: `${origin.origin}/${token}`,
        expiresAt,
        viewOnly: true,
        notice:
          "Anyone with this link can view the trip for seven days.",
      };
    },
    async revoke(actor: Actor, tripId: string) {
      if (
        !/\b(revoke|disable|remove|stop)\b/i.test(actor.sourceText) ||
        !/\b(sharing|share|links?|access)\b/i.test(actor.sourceText) ||
        /\b(don't|do not|never|not|no)\b/i.test(actor.sourceText)
      )
        throw new Error("Explicit request to disable sharing is required");
      await ownedTrip(actor, tripId);
      const { error } = await client
        .from("wing_trip_links")
        .update({ revoked_at: new Date().toISOString() })
        .eq("owner_id", actor.userId)
        .eq("trip_id", tripId)
        .is("revoked_at", null);
      if (error) throw new Error("Link revocation unavailable");
      return { revoked: true };
    },
    async summary(token: string): Promise<PublicSummary | null> {
      if (!shareTokenPattern.test(token)) return null;
      const { data: link, error: linkError } = await client
        .from("wing_trip_links")
        .select("owner_id,trip_id")
        .eq("token_hash", hashShareToken(token))
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (linkError) throw new Error("Sharing temporarily unavailable");
      if (!link) return null;
      const [trip, profile, reservation] = await Promise.all([
        client
          .from("wing_trips")
          .select("facts,updated_at")
          .eq("owner_id", link.owner_id)
          .eq("id", link.trip_id)
          .maybeSingle(),
        client
          .from("wing_profiles")
          .select("facts")
          .eq("owner_id", link.owner_id)
          .maybeSingle(),
        client.from("wing_flight_reservations").select("action_id,offer,created_at")
          .eq("owner_id", link.owner_id).eq("trip_id", link.trip_id).maybeSingle(),
      ]);
      if (trip.error || profile.error || reservation.error)
        throw new Error("Trip temporarily unavailable");
      if (!trip.data) return null;
      const summary = projectPlanningSummary(
        trip.data as { facts: Facts; updated_at: string },
        (profile.data?.facts ?? {}) as Facts,
      );
      if (!reservation.data) return summary;
      const offer = offerSchema.parse(reservation.data.offer);
      if (offer.ownerId !== link.owner_id || offer.tripId !== link.trip_id) throw new Error("Booking scope mismatch");
      const [action, ride] = await Promise.all([
        client.from("wing_flight_actions").select("status,offer")
          .eq("owner_id", link.owner_id).eq("trip_id", link.trip_id).eq("id", reservation.data.action_id).maybeSingle(),
        client.from("wing_journey_actions").select("payload,created_at")
          .eq("owner_id", link.owner_id).eq("trip_id", link.trip_id).eq("flight_action_id", reservation.data.action_id)
          .eq("kind", "ride").eq("status", "confirmed").maybeSingle(),
      ]);
      if (action.error || ride.error) throw new Error("Trip temporarily unavailable");
      if (action.data?.status !== "confirmed" || JSON.stringify(offerSchema.parse(action.data.offer)) !== JSON.stringify(offer)) throw new Error("Booking not verified");
      const leg = (segment: typeof offer.outbound[number]) => ({
        flightNumber: segment.flightNumber, departureAirport: segment.departureAirport, arrivalAirport: segment.arrivalAirport,
        departureName: airports[segment.departureAirport]?.name ?? segment.departureAirport,
        arrivalName: airports[segment.arrivalAirport]?.name ?? segment.arrivalAirport,
        departureCity: airports[segment.departureAirport]?.city ?? segment.departureAirport,
        arrivalCity: airports[segment.arrivalAirport]?.city ?? segment.arrivalAirport,
        departsAt: segment.departsAt, arrivesAt: segment.arrivesAt,
        departureTimeZone: segment.departureTimeZone, arrivalTimeZone: segment.arrivalTimeZone,
      });
      const first = offer.outbound[0]!, last = offer.outbound.at(-1)!;
      const localDate = (instant: string, zone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));
      const pickup = ride.data ? rideSchema.parse(ride.data.payload) : null;
      if (pickup && pickup.airport !== first.departureAirport) throw new Error("Ride scope mismatch");
      return publicSummarySchema.parse({
        ...summary, status: "booked", departureAirport: first.departureAirport, arrivalAirport: last.arrivalAirport,
        outboundDate: localDate(first.departsAt, first.departureTimeZone),
        returnDate: localDate(offer.inbound[0]!.departsAt, offer.inbound[0]!.departureTimeZone),
        updatedAt: [summary.updatedAt, reservation.data.created_at, ride.data?.created_at].filter((value): value is string => !!value).sort((a, b) => Date.parse(b) - Date.parse(a))[0],
        booking: { airline: offer.airline, cabin: offer.cabin, baggage: offer.baggage, outbound: offer.outbound.map(leg), inbound: offer.inbound.map(leg), simulated: true },
        ...(pickup ? { ride: { provider: "Uber", status: "reserved", pickupLabel: "Trip pickup", airport: pickup.airport, pickupAt: pickup.pickupAt, airportAt: pickup.airportAt, timeZone: pickup.timeZone, simulated: true } } : {}),
      });
    },
  };
}
export type SharingStore = ReturnType<typeof createSharingStore>;
