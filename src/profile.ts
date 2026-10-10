import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actor } from "./contracts.ts";

const privateText = /\b(street|avenue|road|lane|boulevard|drive|court|password|secret|token|credentials|cvv|card|api[ -]?key)\b/i;
const travelText = z.string().trim().min(1).max(200).refine((value) => !/[0-9@:/=_]/.test(value) && !privateText.test(value), "Use a travel preference or city, not an address or credential");
const airport = z.string().regex(/^[A-Z]{3}$/);
const timeZone = z.string().refine((value) => {
  if (value !== "UTC" && !value.includes("/")) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}, "Use an IANA time zone such as America/New_York");
const preferenceFields = {
  timeZone: timeZone.optional(), departureAirport: airport.optional(),
  budgetCents: z.number().int().nonnegative().max(10_000_000).optional(),
  budgetMeaning: z.enum(["round_trip_airfare_per_person", "whole_trip"]).optional(),
  nonstop: z.boolean().optional(), baggage: z.enum(["personal_item", "carry_on", "checked_bag"]).optional(),
  cabin: z.literal("economy").optional(), arrivalPreference: travelText.optional(),
  earliestDeparture: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  latestDeparture: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
};
export const profilePatchSchema = z.object({ ...preferenceFields, homeAirport: airport.optional(), name: travelText.optional(), school: travelText.optional(), schoolCity: travelText.optional(), homeCity: travelText.optional(), notifications: z.boolean().optional() }).strict().refine((value) => Object.keys(value).length > 0, "Provide a preference to update");
export const tripPatchSchema = z.object({ ...preferenceFields, arrivalAirport: airport.optional(), outboundDate: z.iso.date().optional(), returnDate: z.iso.date().optional(), allowMissedCommitments: z.boolean().optional() }).strict().refine((value) => Object.keys(value).length > 0, "Provide a trip constraint to update");
export const factStatusSchema = z.enum(["confirmed", "tentative"]);
type Fact = { value: unknown; sourceMessageId: string; updatedAt: string };
export type Facts = Record<string, { confirmed?: Fact; tentative?: Fact }>;
export function confirmedFacts(facts: Facts) {
  return Object.fromEntries(Object.entries(facts).filter(([, fact]) => fact.confirmed).map(([key, fact]) => [key, fact.confirmed!.value]));
}
export type Trip = { id: string; title: string; purpose: string; facts: Facts; version: number; status: string };
export function resolveTrip(trips: Trip[], activeId: string | null, reference?: string, ambiguous = false) {
  const matches = reference ? trips.filter((trip) => trip.id === reference || (reference.length >= 8 && trip.id.startsWith(reference)) || trip.title.toLowerCase() === reference.toLowerCase())
    : ambiguous ? trips : trips.filter((trip) => trip.id === activeId);
  if (matches.length === 1) return matches[0]!;
  if (!reference && !ambiguous && trips.length === 1) return trips[0]!;
  throw new Error("Choose a specific trip by title before editing");
}

export function createProfileStore(client: SupabaseClient) {
  return {
    async state(ownerId: string) {
      const [profile, trips, addresses] = await Promise.all([
        client.from("wing_profiles").select("*").eq("owner_id", ownerId).maybeSingle(),
        client.from("wing_trips").select("id,title,purpose,facts,version,status").eq("owner_id", ownerId).order("created_at", { ascending: false }).limit(20),
        client.from("wing_addresses").select("id,kind,address,confirmed").eq("owner_id", ownerId).order("updated_at", { ascending: false }).limit(10),
      ]);
      if (profile.error || trips.error || addresses.error) throw new Error("Private state unavailable");
      return {
        profile: (profile.data?.facts ?? {}) as Facts, version: Number(profile.data?.version ?? 1),
        activeTripId: (profile.data?.active_trip_id ?? null) as string | null, trips: (trips.data ?? []) as Trip[],
        savedAddressKinds: [...new Set((addresses.data ?? []).filter((address) => address.confirmed).map((address) => address.kind))],
        pendingAddress: (addresses.data ?? []).find((address) => !address.confirmed) ?? null,
        memoryEvidence: profile.data?.memory_evidence ?? {},
      };
    },
    async patch(actor: Actor, patch: unknown, status: z.infer<typeof factStatusSchema>, trip?: Trip) {
      const parsed = trip ? tripPatchSchema.parse(patch) : profilePatchSchema.parse(patch);
      if (trip && status === "confirmed") {
        const merged: Record<string, unknown> = { ...confirmedFacts(trip.facts), ...parsed };
        if (typeof merged.outboundDate === "string" && typeof merged.returnDate === "string" && merged.returnDate <= merged.outboundDate) throw new Error("Return date must follow departure date");
        if ("allowMissedCommitments" in parsed && parsed.allowMissedCommitments && (!/\b(miss|skip|missing|skipping)\b/i.test(actor.sourceText) || /\b(don't|do not|cannot|can't|never|not|no)\b/i.test(actor.sourceText))) throw new Error("Explicit permission to miss a commitment is required for this trip");
      }
      const { data, error } = await client.rpc("wing_patch_facts", { p_owner: actor.userId, p_source: actor.sourceMessageId, p_patch: parsed,
        p_status: factStatusSchema.parse(status), p_trip: trip?.id ?? null, p_version: trip?.version ?? null });
      if (error) throw new Error("Preference update rejected; reload the current state before retrying");
      return data as { facts: Facts; version: number };
    },
    async createTrip(actor: Actor, title: string, purpose: string) {
      const { data, error } = await client.from("wing_trips").upsert({ owner_id: actor.userId, title: z.string().trim().min(1).max(100).parse(title),
        purpose: z.string().trim().min(1).max(200).parse(purpose), creation_message_id: actor.sourceMessageId }, { onConflict: "owner_id,creation_message_id,title" }).select("id,title,purpose,facts,version,status").single();
      if (error) throw new Error("Trip creation failed");
      await this.activate(actor.userId, data.id);
      return data as Trip;
    },
    async activate(ownerId: string, tripId: string) {
      const { data: trip, error: tripError } = await client.from("wing_trips").select("id").eq("owner_id", ownerId).eq("id", z.uuid().parse(tripId)).single();
      if (tripError || !trip) throw new Error("Trip unavailable");
      const { error } = await client.from("wing_profiles").upsert({ owner_id: ownerId, active_trip_id: tripId }, { onConflict: "owner_id" });
      if (error) throw new Error("Active trip update failed");
    },
    async proposeAddress(actor: Actor, kind: "campus" | "home", address: string) {
      const value = z.string().trim().min(5).max(500).parse(address);
      if (!actor.sourceText.toLowerCase().includes(value.toLowerCase())) throw new Error("Ask the user to provide the exact address before saving it");
      const consent = /\b(save|remember|store)\b/i.test(actor.sourceText) && !/\b(don't|do not|not|no|temporary|this time|this trip)\b/i.test(actor.sourceText);
      const { data, error } = await client.from("wing_addresses").upsert({ owner_id: actor.userId, source_message_id: actor.sourceMessageId,
        consent_message_id: consent ? actor.sourceMessageId : null, kind, address: value, confirmed: consent }, { onConflict: "owner_id,source_message_id,kind,address" }).select("id,kind,confirmed").single();
      if (error) throw new Error("Private address save failed");
      return data;
    },
    async confirmAddress(actor: Actor, addressId: string) {
      if (!/^(yes|yeah|yep|sure|okay|ok|save it|remember it|please save it)[!.\s]*$/i.test(actor.sourceText.trim())) throw new Error("Explicit address-saving consent is required");
      const state = await this.state(actor.userId);
      if (state.pendingAddress?.id !== addressId) throw new Error("Address consent is not bound to the pending address");
      const { error } = await client.from("wing_addresses").update({ confirmed: true, consent_message_id: actor.sourceMessageId }).eq("owner_id", actor.userId).eq("id", addressId);
      if (error) throw new Error("Private address consent save failed");
      return { confirmed: true, kind: state.pendingAddress.kind };
    },
    async evidence(ownerId: string, evidence: { origin: string; context: string; sourceIds: string[]; degraded: boolean }) {
      const { error } = await client.from("wing_profiles").upsert({ owner_id: ownerId, memory_evidence: { ...evidence, at: new Date().toISOString() } }, { onConflict: "owner_id" });
      if (error) throw new Error("Memory evidence update failed");
    },
    async rejectAddress(actor: Actor, addressId: string) {
      if (!/\b(no|don't|do not)\b/i.test(actor.sourceText)) throw new Error("Address decline must come from the user");
      const { error } = await client.from("wing_addresses").delete().eq("owner_id", actor.userId).eq("id", z.uuid().parse(addressId)).eq("confirmed", false);
      if (error) throw new Error("Pending address removal failed");
      return { saved: false };
    },
    async pickupOverride(actor: Actor, trip: Trip, address: string) {
      const value = z.string().trim().min(3).max(500).parse(address);
      if (!actor.sourceText.toLowerCase().includes(value.toLowerCase())) throw new Error("The pickup override must come from the current user message");
      const { data, error } = await client.from("wing_trips").update({
        pickup_override: { address: value, sourceMessageId: actor.sourceMessageId, updatedAt: new Date().toISOString() }, version: trip.version + 1,
      }).eq("owner_id", actor.userId).eq("id", trip.id).eq("version", trip.version).select("id").single();
      if (error || !data) throw new Error("Trip pickup changed or unavailable; reload before editing");
      return { saved: true, temporaryForTrip: trip.title, generalAddressChanged: false };
    },
  };
}
export type ProfileStore = ReturnType<typeof createProfileStore>;
