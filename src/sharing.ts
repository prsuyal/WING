import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
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
      if (
        !/\b(share|link)\b/i.test(actor.sourceText) ||
        /\b(don't|do not|never|not|no)\b/i.test(actor.sourceText)
      )
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
          "Anyone with this link can see the traveler's saved display name, confirmed airports and dates, and planning status. Flights and rides are not arranged. Localhost links open only on the machine running the website.",
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
      const [trip, profile] = await Promise.all([
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
      ]);
      if (trip.error || profile.error)
        throw new Error("Trip temporarily unavailable");
      if (!trip.data) return null;
      return projectPlanningSummary(
        trip.data as { facts: Facts; updated_at: string },
        (profile.data?.facts ?? {}) as Facts,
      );
    },
  };
}
export type SharingStore = ReturnType<typeof createSharingStore>;
