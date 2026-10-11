import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actor } from "./contracts.ts";
import { offerSchema, isYes, understands, naturalText } from "./contracts.ts";
import { actorTrip, type ProfileStore } from "./profile.ts";
import { assumptionsSchema, legText, type Offer } from "./flights.ts";
import type { FlightPlanner } from "./flight-store.ts";

const receiptSchema = z.object({ status: z.enum(["confirmed", "failed"]), reference: z.string().startsWith("DEMO-").optional(), simulated: z.literal(true) }).refine((receipt) => receipt.status !== "confirmed" || !!receipt.reference);
const actionSchema = z.object({ id: z.uuid(), owner_id: z.uuid(), trip_id: z.uuid(), search_id: z.uuid(), source_message_id: z.uuid(), approval_message_id: z.uuid().nullable(), offer: offerSchema, assumptions: assumptionsSchema, conflicts: z.array(z.string()), review_text: z.string(), expires_at: z.string(), status: z.enum(["review", "processing", "confirmed", "failed", "unknown", "superseded"]), lease: z.uuid().nullable(), leased_until: z.string().nullable() });
type BookingAction = z.infer<typeof actionSchema>;
export function bookingApproval(text: string) {
  return isYes(text) || /^\/approve-flight [0-9a-f-]{8,36}$/i.test(text.trim());
}
export function selectedOption(text: string, offers: Offer[], suggested?: number) {
  text = text.trim().replace(/^(?:(?:ok(?:ay)?|cool|great|sure)[,\s]+)*(?:let['’]?s\s+)?(?:do|go with)\s+(?:option\s+)?([1-3])[!.\s]*$/i, "option $1");
  const choices = [...text.matchAll(/(?:\b(?:option|number|choice|book|take|choose|select)\s*#?\s*|#)([1-3])\b|\b(first|second|third)\b/gi)];
  if (choices.length > 1 || /\b[1-3]\s*(?:or|and|\/)\s*[1-3]\b/i.test(text)) throw new Error("which option did you mean?");
  const numeric = text.match(/(?:\b(?:option|number|choice|book|take|choose|select)\s*#?\s*|#)([1-3])\b/i) || text.match(/^\s*([1-3])(?:\s+please)?[!.\s]*$/i);
  const ordinal = text.match(/\b(first|second|third)\b/i);
  let chosen = numeric ? Number(numeric[1]) : ordinal ? ["first", "second", "third"].indexOf(ordinal[1]!.toLowerCase()) + 1 : undefined;
  if (/\bcheapest\b/i.test(text)) {
    const lowest = Math.min(...offers.map((offer) => offer.totalCents)), matches = offers.map((offer, index) => offer.totalCents === lowest ? index + 1 : 0).filter(Boolean);
    if (matches.length === 1) chosen = matches[0];
  }
  if (!chosen && offers.length === 1 && /\b(book|take|choose|select)\s+(?:(?:this|that)(?:\s+(?:one|flight|option))?|it|the\s+(?:recommended\s+)?(?:one|flight|option))\b/i.test(text) && !/\b(another|different|other)\b/i.test(text)) chosen = 1;
  if (!chosen || chosen > offers.length || (suggested !== undefined && suggested !== chosen) || /\?|\b(don't|do not|not|no|maybe|if|unless|instead)\b/i.test(text)) throw new Error("which option did you mean?");
  return chosen;
}
export function bookingReview(_id: string, offer: Offer, conflicts: string[], _label?: string, scheduleChecked = true) {
  const money = `$${(offer.totalCents / 100).toFixed(offer.totalCents % 100 ? 2 : 0)}`;
  const legs = (name: string, segments: Offer["outbound"]) => segments.map((segment, index) => `${index ? "connection" : name}: ${segment.departureAirport} → ${segment.arrivalAirport}${offer.simulated ? "" : ` · ${segment.flightNumber}`}\n${legText(segment, segment)}`).join("\n");
  const bags = offer.simulated ? `${offer.baggage.split(" included")[0]!.replace("carry on", "carry-on")} included` : offer.baggage;
  return `save this for ${money} round trip?\n\n${legs("outbound", offer.outbound)}\n\n${legs("return", offer.inbound)}\n\n1 person · economy · ${bags}\n${scheduleChecked ? "" : "schedule not checked, calendar isn't connected\n"}${conflicts.length ? `misses ${conflicts.join(", ")} with your permission\n` : ""}\nthis is a simulated booking, no real ticket or charge\nreply yes to confirm, or no`;
}
export function bookingConfirmation(_offer: Offer, _reference: string, already = false) {
  return already ? "already saved! just one simulated reservation" : "saved! your simulated reservation is ready\n\nneed a ride to the airport?";
}
export function createDemoBookingProvider(client: SupabaseClient, waitMs = 1200) {
  return {
    async reserve(owner: string, action: string, lease: string) {
      await delay(waitMs);
      const { data, error } = await client.rpc("wing_demo_reserve_flight", { p_owner: owner, p_action: action, p_lease: lease, p_outcome: "confirmed" });
      if (error) throw new Error("Simulated booking response unavailable");
      return receiptSchema.parse(data);
    },
    async lookup(owner: string, action: string) {
      const { data, error } = await client.from("wing_flight_reservations").select("reference,simulated,offer").eq("owner_id", owner).eq("action_id", action).maybeSingle();
      if (error) throw new Error("Reservation lookup unavailable");
      return data ? { ...receiptSchema.parse({ ...data, status: "confirmed" }), offer: offerSchema.parse(data.offer) } : null;
    },
  };
}
export function createBookings(client: SupabaseClient, profiles: ProfileStore, flights: FlightPlanner, provider = createDemoBookingProvider(client)) {
  async function actions(owner: string) {
    const { data, error } = await client.from("wing_flight_actions").select("*").eq("owner_id", owner).order("created_at", { ascending: false }).limit(30);
    if (error) throw new Error("Booking state unavailable");
    return (data ?? []).map((row) => actionSchema.parse(row));
  }
  async function lastReply(owner: string) {
    const { data, error } = await client.from("wing_messages").select("body,status").eq("owner_id", owner).eq("direction", "outbound").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error("Review delivery unavailable");
    return data?.status === "sent" ? data.body.text as string : null;
  }
  async function confirmedReceipt(actor: Actor, action: BookingAction) {
    const receipt = await provider.lookup(actor.userId, action.id);
    if (!receipt || receipt.offer.ownerId !== actor.userId || receipt.offer.tripId !== action.trip_id || JSON.stringify(receipt.offer) !== JSON.stringify(action.offer)) throw new Error("Reservation could not be verified");
    return receipt;
  }
  async function confirmed(actor: Actor, action: BookingAction, already = false) {
    const receipt = await confirmedReceipt(actor, action);
    const facts = bookingConfirmation(receipt.offer, receipt.reference!, already);
    // Wording failure cannot turn a verified reservation into an uncertain outcome.
    return naturalText(actor, facts, "confirmation").catch(() => facts);
  }
  return {
    async details(actor: Actor, reference?: string) {
      const trip = actorTrip(await profiles.state(actor.userId), actor, reference);
      const action = (await actions(actor.userId)).find((row) => row.trip_id === trip.id && row.status === "confirmed");
      return action ? confirmedReceipt(actor, action) : { message: "This trip doesn't have a confirmed booking yet." };
    },
    async state(owner: string) {
      return (await actions(owner)).map(({ id, trip_id, status, review_text }) => ({ id, tripId: trip_id, status, review: status === "review" ? review_text : undefined }));
    },
    async select(actor: Actor, option?: number, reference?: string) {
      const state = await profiles.state(actor.userId), trip = actorTrip(state, actor, reference);
      const previous = (await actions(actor.userId)).find((action) => action.trip_id === trip.id && ["confirmed", "processing", "unknown"].includes(action.status));
      if (previous?.status === "confirmed") return confirmed(actor, previous, true);
      if (previous) return "let's check that booking first, say check my booking";
      const saved = await flights.latest(actor, trip.id);
      if (!saved.result || !saved.searchId) return saved.message;
      const choice = actor.interpret ? z.number().int().min(1).max(saved.result.options.length).parse(option ?? (saved.result.options.length === 1 ? 1 : undefined)) : selectedOption(actor.sourceText, saved.result.options.map((item) => item.offer), option);
      if (actor.interpret && !await actor.interpret(`Select flight option ${choice} for a booking review, not approval. Displayed options: ${saved.presentation ?? saved.message}. Do not guess between multiple options or interpret a date/budget/calendar number as a flight choice`)) throw new Error("which option did you mean?");
      const selected = saved.result.options[choice - 1]!;
      // A follow-up question may follow the offer; approval still requires the latest exact review.
      const { data: delivered, error: deliveryError } = await client.from("wing_messages").select("id").eq("owner_id", actor.userId).eq("direction", "outbound").eq("status", "sent").gte("created_at", saved.createdAt!).in("body->>text", [saved.message, saved.presentation ?? saved.message]).limit(1);
      if (deliveryError) throw new Error("Offer delivery unavailable");
      if (!delivered?.length) return "let me show you the current flight first";
      await flights.verify(actor, saved.searchId, selected.offer, saved.result.assumptions);
      const id = randomUUID(), review = await naturalText(actor, bookingReview(id, selected.offer, selected.conflicts, undefined, saved.result.scheduleChecked !== false));
      const { data, error } = await client.rpc("wing_review_flight", { p_owner: actor.userId, p_source: actor.sourceMessageId, p_search: saved.searchId, p_option: choice, p_id: id, p_review: review });
      if (error) throw new Error("Options changed; show a fresh flight search before selecting");
      const action = (await actions(actor.userId)).find((item) => item.id === data);
      if (!action) throw new Error("Booking review unavailable");
      return action.review_text;
    },
    async review(actor: Actor, reference?: string) {
      const trip = actorTrip(await profiles.state(actor.userId), actor, reference), action = (await actions(actor.userId)).find((item) => item.trip_id === trip.id && item.status !== "superseded");
      if (!action) return "no flight picked yet — which one?";
      if (action.status === "confirmed") return confirmed(actor, action, true);
      if (action.status === "failed") return "booking failed — nothing booked\nwant fresh options?";
      if (action.status === "processing" && Date.parse(action.leased_until!) > Date.now()) return "still checking — haven't sent another booking request";
      const receipt = await provider.lookup(actor.userId, action.id);
      if (receipt) return confirmed(actor, action, true);
      const saved = await flights.latest(actor, trip.id);
      if (Date.parse(action.expires_at) <= Date.now() || !saved.result || saved.searchId !== action.search_id) {
        let update = client.from("wing_flight_actions").update({ status: "superseded", lease: null, leased_until: null }).eq("owner_id", actor.userId).eq("id", action.id).eq("status", action.status);
        update = action.lease ? update.eq("lease", action.lease) : update.is("lease", null);
        const { data, error } = await update.select("id").maybeSingle();
        if (error) throw new Error("Booking reconciliation unavailable");
        if (!data) {
          const receipt = await provider.lookup(actor.userId, action.id);
          if (receipt) return confirmed(actor, action, true);
          throw new Error("The request changed while checking it; check /booking again");
        }
        return "that review expired or changed — no reservation saved\nsearch again?";
      }
      return action.review_text;
    },
    async decline(actor: Actor, id: string) {
      if (!await understands(actor, "Decline the pending flight booking review; do not cancel an existing reservation", /^(no|nope|cancel|cancel it)[!.\s]*$/i.test(actor.sourceText.trim()))) throw new Error("Explicit decline is required");
      const action = (await actions(actor.userId)).find((row) => row.id === z.uuid().parse(id) && row.status === "review");
      if (!action || await lastReply(actor.userId) !== action.review_text) throw new Error("Show the current review before declining it");
      const { data, error } = await client.from("wing_flight_actions").update({ status: "superseded" }).eq("owner_id", actor.userId).eq("id", id).eq("status", "review").select("id").maybeSingle();
      if (error || !data) throw new Error("That review changed, check its status first");
      return "got you, won't book it";
    },
    async approve(actor: Actor, reference: string) {
      if (actor.replyInFlight || !await understands(actor, "Approve the exact flight booking review in the last delivered message without conditions or changed terms", bookingApproval(actor.sourceText))) throw new Error("Please approve the exact review with a separate yes");
      z.string().regex(/^[0-9a-f-]{8,36}$/i).parse(reference);
      const matches = (await actions(actor.userId)).filter((action) => action.id.startsWith(reference));
      if (matches.length !== 1) throw new Error("Booking review unavailable or ambiguous");
      const action = matches[0]!;
      if (action.status === "confirmed") return confirmed(actor, action, true);
      if (action.status === "processing" && Date.parse(action.leased_until!) > Date.now()) return "still checking — haven't sent another booking request";
      if (action.status === "unknown" || action.status === "processing") {
        const receipt = await provider.lookup(actor.userId, action.id);
        if (receipt) return confirmed(actor, action, true);
      }
      if (!["review", "unknown", "processing"].includes(action.status) || Date.parse(action.expires_at) <= Date.now()) throw new Error("That review is no longer valid; search again and choose fresh options");
      if (actor.sourceMessageId === action.source_message_id) throw new Error("Approve the review separately");
      if (await lastReply(actor.userId) !== action.review_text) return this.review(actor, action.trip_id);
      await flights.verify(actor, action.search_id, action.offer, action.assumptions);
      const lease = randomUUID(), { data: claimed, error } = await client.rpc("wing_claim_flight", { p_owner: actor.userId, p_action: action.id, p_source: actor.sourceMessageId, p_lease: lease });
      if (error) throw new Error("The price, preferences or review changed; search again and review before approving");
      if (!claimed) return (await actions(actor.userId)).find((item) => item.id === action.id)?.status === "confirmed" ? confirmed(actor, action, true) : "still checking — haven't sent another booking request";
      try {
        const outcome = await provider.reserve(actor.userId, action.id, lease);
        if (outcome.status === "failed") return "booking failed — nothing booked\nwant fresh options?";
        return await confirmed(actor, action);
      } catch {
        await client.from("wing_flight_actions").update({ status: "unknown" }).eq("owner_id", actor.userId).eq("id", action.id).eq("status", "processing").eq("lease", lease);
        return "couldn't confirm that yet, say check my booking before retrying";
      }
    },
    async command(actor: Actor): Promise<string | null> {
      const text = actor.sourceText.trim();
      if (text === "/booking" || /^(?:check|show)(?: my| the)? booking(?: status)?[!.\s]*$/i.test(text)) return this.review(actor);
      if (text.startsWith("/approve-flight ")) return this.approve(actor, text.slice(16).trim());
      const choiceText = /^(?:\d+|(?:ok(?:ay)?[,\s]+)?(?:cool[,\s]+)?(?:let['’]?s\s+)?(?:do|go with)\s+(?:option\s+)?\d+|(?:option|number|choice)\s*#?\s*\d+)[!.\s]*$|\b(?:book|take|choose|select)\s+(?:option\s*#?\s*\d+|#?\d+|(?:this|that)(?: one)?|it|the (?:first|second|third|cheapest)(?: one)?)\b/i.test(text);
      if (!choiceText && !bookingApproval(text) && !/^(no|nope|cancel|cancel it)[!.\s]*$/i.test(text)) return null;
      const last = await lastReply(actor.userId), rows = await actions(actor.userId), current = rows.find((row) => row.review_text === last && ["review", "unknown", "processing"].includes(row.status));
      if (current) {
        if (bookingApproval(text)) return this.approve(actor, current.id);
        if (current.status !== "review") return "might already be processing, say check my booking first";
        const { data, error } = await client.from("wing_flight_actions").update({ status: "superseded" }).eq("owner_id", actor.userId).eq("id", current.id).eq("status", "review").select("id").maybeSingle();
        if (error) throw new Error("Booking decline unavailable");
        if (!data) return "that request changed — check /booking";
        return "got you — won't book it";
      }
      if (choiceText && !bookingApproval(text)) {
        if (/^\d+[!.\s]*$/.test(text) && !/(?:found one|i'd pick 1)/.test(last ?? "")) return null;
        const saved = await flights.latest(actor);
        if (!saved.result) return /^\d+[!.\s]*$/.test(text) ? null : saved.message;
        if (/^\d+[!.\s]*$/.test(text) && last !== saved.message && last !== saved.presentation) return null;
        try { return await this.select(actor); }
        catch (error) {
          if (error instanceof Error && error.message.startsWith("which option")) return `which one? pick 1${saved.result.options.length > 1 ? `–${saved.result.options.length}` : ""}`;
          throw error;
        }
      }
      const { data: delivered } = bookingApproval(text) ? await client.from("wing_messages").select("parent_id").eq("owner_id", actor.userId).eq("direction", "outbound").order("created_at", { ascending: false }).limit(1).maybeSingle() : { data: null };
      if (bookingApproval(text)) for (const row of rows.filter((row) => row.status === "confirmed")) {
        if (row.approval_message_id !== delivered?.parent_id) continue;
        const receipt = await provider.lookup(actor.userId, row.id);
        if (receipt && (last === bookingConfirmation(row.offer, receipt.reference!) || last === bookingConfirmation(row.offer, receipt.reference!, true))) return confirmed(actor, row, true);
      }
      if (bookingApproval(text) && /couldn['’]t (?:finish|verify|check|approve) that booking/i.test(last ?? "")) {
        const pending = rows.filter((row) => row.status === "review");
        if (pending.length === 1) return this.review(actor, pending[0]!.trip_id);
        if (pending.length > 1) return "which trip are you approving?";
      }
      return null;
    },
  };
}
export type Bookings = ReturnType<typeof createBookings>;
