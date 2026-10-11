import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isYes, understands, offerSchema, type Actor } from "./contracts.ts";
import { actorTrip, confirmedFacts, type ProfileStore } from "./profile.ts";
import { demoInventory, planningSchema } from "./flights.ts";
import type { FlightPlanner } from "./flight-store.ts";
import { selectedOption } from "./booking.ts";
import { qualifiesPrice, priceNotice, reminderTime } from "./notifications.ts";
import { zoneSchema } from "./schedule.ts";

export const watchInputSchema = z.object({ reference: z.string().optional(), option: z.number().int().min(1).max(3).default(1), mode: z.enum(["target", "drop"]), targetCents: z.number().int().min(100).max(200000).optional(), minimumDropCents: z.number().int().min(100).max(100000).default(2000), notify: z.boolean().default(false) }).strict();
const positiveRequest = (text: string, action: string) => new RegExp(`\\b(${action})\\b`, "i").test(text) && !new RegExp(`\\b(don't|do not|never|not)\\s+(?:\\w+\\s+)?(${action})\\b`, "i").test(text.replaceAll("’", "'"));
const hasAmount = (text: string, cents: number) => [...text.replaceAll(",", "").matchAll(/(?:^|[^\w.])(\d+(?:\.\d{1,2})?)(?![\w.])/g)].some((match) => Math.round(Number(match[1]) * 100) === cents);
const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
function watchSummary(watch: any, title: string) { return `watching ${title} ${watch.mode === "target" ? `for ${money(watch.target_cents)} or less` : `for a ${money(watch.minimum_drop_cents)} drop`} (${watch.offer?.simulated === false ? "live quotes" : "simulated prices"})\n${watch.notify ? "texts 8am–10pm, at most one a day" : "text you when it happens?"}`; }
export function createAlerts(client: SupabaseClient, profiles: ProfileStore, flights: FlightPlanner) {
  async function watches(owner: string) { const { data, error } = await client.from("wing_watches").select("*").eq("owner_id", owner).order("created_at", { ascending: false }).limit(50); if (error) throw new Error("Watch state unavailable"); return data ?? []; }
  async function watch(actor: Actor, reference?: string) { const trip = actorTrip(await profiles.state(actor.userId), actor, reference), row = (await watches(actor.userId)).find((item) => item.trip_id === trip.id && item.status === "active"); if (!row) throw new Error("No active watch for this trip"); return { trip, row }; }
  return {
    async state(owner: string) {
      const { data: reminders, error } = await client.from("wing_jobs").select("trip_id,kind,due_at,status").eq("owner_id", owner).eq("kind", "reminder").order("due_at").limit(30);
      if (error) throw new Error("Reminder state unavailable");
      return { watches: (await watches(owner)).map(({ id, trip_id, mode, target_cents, minimum_drop_cents, observed_cents, notify, status, checked_at }) => ({ id, tripId: trip_id, mode, targetCents: target_cents, minimumDropCents: minimum_drop_cents, latestCents: observed_cents, notify, status, checkedAt: checked_at })), reminders };
    },
    async createWatch(actor: Actor, input: unknown) {
      const query = watchInputSchema.parse(input);
      if (actor.interpret) {
        if (!await actor.interpret(`Create this price watch exactly: ${JSON.stringify(query)}. Target/drop amounts must be requested by the person; a missing drop amount may default to $20. notify=true requires an explicit request to receive texts, not merely to monitor a price. Never infer consent from history`)) throw new Error("State the watch and notification preferences explicitly");
      } else {
      if (!positiveRequest(actor.sourceText, "watch|monitor|notify|alert|text")) throw new Error("Ask to watch this trip explicitly");
      if (query.notify && !positiveRequest(actor.sourceText, "notify|alert|text|tell me|let me know")) throw new Error("Notification consent is required");
      if (query.mode === "target" && (!query.targetCents || !hasAmount(actor.sourceText, query.targetCents))) throw new Error("State the target price explicitly");
      if (query.mode === "drop" && query.minimumDropCents !== 2000 && !hasAmount(actor.sourceText, query.minimumDropCents)) throw new Error("State the requested drop explicitly");
      }
      const saved = await flights.latest(actor, query.reference);
      if (!saved.result || !saved.searchId || !saved.tripId) return saved.message;
      const state = await profiles.state(actor.userId), trip = actorTrip(state, actor, saved.tripId);
      const { data: delivered, error: deliveryError } = await client.from("wing_messages").select("id").eq("owner_id", actor.userId).eq("direction", "outbound").eq("status", "sent").gte("created_at", saved.createdAt!).in("body->>text", [saved.message, saved.presentation ?? saved.message]).limit(1);
      if (deliveryError || !delivered?.length) throw new Error("Show these options before setting a watch");
      const chosen = actor.interpret ? z.number().int().min(1).max(saved.result.options.length).parse(query.option) : saved.result.options.length === 1 && query.option === 1 ? 1 : selectedOption(actor.sourceText, saved.result.options.map((item) => item.offer), query.option);
      const offer = saved.result.options[chosen - 1]!.offer;
      await flights.verify(actor, saved.searchId, offer, saved.result.assumptions);
      const { data, error } = await client.rpc("wing_save_watch", { p_owner: actor.userId, p_trip: trip.id, p_search: saved.searchId, p_source: actor.sourceMessageId, p_offer: offer, p_mode: query.mode, p_target: query.mode === "target" ? query.targetCents : null, p_drop: query.minimumDropCents, p_notify: query.notify, p_zone: planningSchema.parse({ ...confirmedFacts(state.profile), ...confirmedFacts(trip.facts), arrivalAirport: offer.outbound.at(-1)!.arrivalAirport }).timeZone });
      if (error) throw new Error("Watch changed or could not be saved");
      return watchSummary((await watches(actor.userId)).find((row) => row.id === data)!, trip.title);
    },
    async check(actor: Actor, reference?: string) {
      const state = await profiles.state(actor.userId), trip = actorTrip(state, actor, reference), row = (await watches(actor.userId)).find((item) => item.trip_id === trip.id && item.status === "active");
      if (row) {
        const quoted = await flights.watchQuote(actor.userId, row.search_id, row.comparison_key);
        if (quoted.status === "changed") return "that watch needs new dates/preferences — search again and set a fresh watch";
        if (quoted.status === "unknown") return "can't verify your schedule right now — no free-time assumptions";
        if (quoted.status !== "available") return "that itinerary doesn't fit anymore — want fresh options?";
        const price = quoted.offer!.totalCents, qualifies = qualifiesPrice(price, row.anchor_cents, row.mode, row.target_cents, row.minimum_drop_cents);
        return qualifies ? priceNotice(trip.title, price, row.anchor_cents, quoted.offer!.simulated) : `${money(price)} round trip (${quoted.offer!.simulated ? "simulated prices" : "live quote"}) — ${price === row.observed_cents ? "no useful price change yet" : "not at your target/drop yet"}`;
      }
      const { data: reservation, error } = await client.from("wing_flight_reservations").select("offer").eq("owner_id", actor.userId).eq("trip_id", trip.id).maybeSingle();
      if (error) throw new Error("Trip status unavailable");
      if (!reservation) return "no active watch for this trip";
      const offer = offerSchema.parse(reservation.offer);
      const { data: notices, error: noticeError } = await client.from("wing_notices").select("status").eq("owner_id", actor.userId).eq("trip_id", trip.id).order("created_at", { ascending: false }).limit(1);
      if (noticeError) throw new Error("Reminder status unavailable");
      return `simulated reservation saved · ${offer.outbound[0]!.departureAirport} ↔ ${offer.outbound.at(-1)!.arrivalAirport}${notices?.[0]?.status === "unknown" ? "\nlast reminder delivery couldn't be confirmed — i won't send a duplicate" : ""}`;
    },
    async stop(actor: Actor, reference?: string) {
      if (!await understands(actor, `Stop future alerts and text reminders for ${reference ? `trip ${reference}` : "all trips"}, not cancel bookings`, positiveRequest(actor.sourceText, "stop|mute|pause|unsubscribe"))) throw new Error("Ask to stop alerts explicitly");
      const global = actor.interpret ? !reference : /^(?:\/stop|stop|unsubscribe)[!.\s]*$/i.test(actor.sourceText.trim()) || /\b(all|everything)\b/i.test(actor.sourceText);
      const state = global ? null : await profiles.state(actor.userId);
      const named = state?.trips.filter((trip) => actor.sourceText.toLowerCase().includes(trip.title.toLowerCase())) ?? [];
      if (named.length > 1) throw new Error("Choose a specific trip by title before muting");
      const scopedReference = named[0]?.id ?? reference;
      const scoped = scopedReference || /\b(this|that) (trip|flight)\b/i.test(actor.sourceText);
      const trip = state && scoped ? actorTrip(state, actor, scopedReference) : null;
      const { error } = await client.rpc("wing_stop_notifications", { p_owner: actor.userId, p_source: actor.sourceMessageId, p_trip: trip?.id ?? null });
      if (error) throw new Error("Could not persist notification stop");
      return trip ? `muted ${trip.title}` : "stopped future alerts and text reminders";
    },
    async reminders(actor: Actor, reference?: string) {
      if (!await understands(actor, "Enable future text reminders for this booked trip, not calendar popup reminders", positiveRequest(actor.sourceText, "remind|reminders|text"))) throw new Error("Ask for text reminders explicitly");
      const state = await profiles.state(actor.userId), trip = actorTrip(state, actor, reference), zone = zoneSchema.parse(confirmedFacts(state.profile).timeZone);
      const { data: reservation, error } = await client.from("wing_flight_reservations").select("action_id,offer").eq("owner_id", actor.userId).eq("trip_id", trip.id).single();
      if (error) throw new Error("Book a flight before adding reminders");
      const offer = offerSchema.parse(reservation.offer);
      if (Date.parse(offer.outbound[0]!.departsAt) <= Date.now()) throw new Error("Set reminders before this trip departs");
      const { data: rides, error: rideError } = await client.from("wing_journey_actions").select("payload").eq("owner_id", actor.userId).eq("trip_id", trip.id).eq("kind", "ride").eq("status", "confirmed").limit(1);
      if (rideError) throw new Error("Booked pickup unavailable");
      const format = (time: string, timeZone: string) => new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(time));
      const payloads = [offer.outbound, offer.inbound].map((legs, index) => {
        const first = legs[0]!, pickup = !index ? rides?.[0]?.payload.pickupAt as string | undefined : undefined;
        const deadline = pickup || first.departsAt, due = reminderTime(deadline, pickup ? 30 : 180, zone);
        return { key: `reminder:${reservation.action_id}:${index}`, flightActionId: reservation.action_id, direction: index ? "return" : "outbound", dueAt: due, expiresAt: deadline, timeZone: zone,
          text: `reminder · ${pickup ? `airport pickup ${format(pickup, first.departureTimeZone)}\n` : ""}${first.departureAirport} → ${first.arrivalAirport} flight ${format(first.departsAt, first.departureTimeZone)}` };
      });
      const { data: count, error: saveError } = await client.rpc("wing_save_reminders", { p_owner: actor.userId, p_trip: trip.id, p_source: actor.sourceMessageId, p_payloads: payloads });
      if (saveError) throw new Error("Could not save trip reminders");
      return count ? "text reminders set for both travel days\n8am–10pm, at most one a day; early flights get an evening heads-up" : "those reminders are already set — no duplicates";
    },
    async demoPrice(actor: Actor, dollars: number, reference?: string) {
      const parsed = actor.sourceText.match(/^\/demo-price\s+(\d+(?:\.\d{1,2})?)(?:\s+(.+))?$/i);
      if (!parsed || Number(parsed[1]) !== dollars) throw new Error("Use /demo-price with an explicit simulated total");
      const { trip, row } = await watch(actor, reference || parsed[2]);
      const { data: search, error } = await client.from("wing_flight_searches").select("request").eq("owner_id", actor.userId).eq("id", row.search_id).single();
      if (error) throw new Error("Scenario search unavailable");
      const preferences = planningSchema.parse(search.request.preferences), offers = demoInventory(actor.userId, trip.id, preferences, search.request.pairs, search.request.nearbyAirports, new Date().toISOString()), base = offers.find((offer) => offer.comparisonKey === row.comparison_key);
      const cents = Math.round(z.number().min(1).max(2000).parse(dollars) * 100);
      if (!base || base.baggageFeeCents === null || cents <= base.baggageFeeCents) throw new Error("Choose a total above the simulated baggage fee");
      const { error: changeError } = await client.rpc("wing_change_demo_price", { p_owner: actor.userId, p_trip: trip.id, p_source: actor.sourceMessageId, p_key: row.comparison_key, p_delta: cents - base.totalCents });
      if (changeError) throw new Error("Demo controls unavailable or trip changed");
      return `simulated price set to ${money(cents)} — normal watch checks will handle it`;
    },
    async enableNotifications(actor: Actor) {
      if (actor.replyInFlight || !await understands(actor, "Allow future price alert texts for the exact watch consent question in the last delivered message", isYes(actor.sourceText))) throw new Error("Notification consent is required");

      const { data: last, error } = await client.from("wing_messages").select("body,status,created_at,parent_id").eq("owner_id", actor.userId).eq("direction", "outbound").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw new Error("Consent delivery unavailable");
      if (last?.status === "sent") {
        const state = await profiles.state(actor.userId);
        for (const row of (await watches(actor.userId)).filter((item) => item.status === "active" && !item.notify)) {
          const title = state.trips.find((trip) => trip.id === row.trip_id)?.title;
          if (title && last.parent_id === row.source_message_id && last.body.text === watchSummary(row, title)) {
            const { error } = await client.rpc("wing_enable_watch", { p_owner: actor.userId, p_watch: row.id, p_source: actor.sourceMessageId, p_review: last.body.text });
            if (error) throw new Error("Fresh notification consent required");
            return "got you — texts 8am–10pm, at most one a day";
          }
        }
      }
      return null;
    },
    async command(actor: Actor): Promise<string | null> {
      const text = actor.sourceText.trim();
      if (/^(?:\/stop|stop|unsubscribe)[!.\s]*$/i.test(text)) return this.stop(actor);
      if (text.startsWith("/mute ")) return this.stop(actor, text.slice(6).trim());
      if (text === "/check-trip") return this.check(actor);
      if (text.startsWith("/check-trip ")) return this.check(actor, text.slice(12).trim());
      if (text.startsWith("/demo-price ")) return this.demoPrice(actor, Number(text.split(/\s+/)[1]));
      if (isYes(text)) return this.enableNotifications(actor);
      return null;
    },
  };
}
export type Alerts = ReturnType<typeof createAlerts>;
