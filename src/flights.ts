import { createHash } from "node:crypto";
import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import { offerSchema, segmentSchema } from "./contracts.ts";
import { availability, localInstant, zoneSchema, type Window } from "./schedule.ts";
import { airportSchema, airportZone as actualAirportZone } from "./airports.ts";

export const planningSchema = z.object({
  departureAirport: airportSchema, arrivalAirport: airportSchema,
  outboundDate: z.iso.date(), returnDate: z.iso.date(), timeZone: zoneSchema,
  budgetCents: z.number().int().nonnegative().nullable().default(null), budgetMeaning: z.literal("round_trip_airfare_per_person").default("round_trip_airfare_per_person"),
  budgetMode: z.enum(["hard_cap", "target", "cheapest"]).optional(),
  nonstop: z.boolean().default(false), baggage: z.enum(["personal_item", "carry_on", "checked_bag"]).default("personal_item"),
  earliestDeparture: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), latestDeparture: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  arrivalPreference: z.string().optional(), allowMissedCommitments: z.boolean().default(false), minLayoverSavingsCents: z.number().int().nonnegative().default(0),
}).transform((preferences) => ({ ...preferences, budgetMode: preferences.budgetMode ?? (preferences.budgetCents === null ? "cheapest" as const : "hard_cap" as const) }));
export type Preferences = z.infer<typeof planningSchema>;
export type Offer = z.infer<typeof offerSchema>;
export const assumptionsSchema = z.object({ airportBufferMinutes: z.number().int().min(30).max(300).default(120), originDriveMinutes: z.number().int().min(0).max(180).default(35), landingBufferMinutes: z.number().int().min(0).max(120).default(30), minimumHomeHours: z.number().min(0).max(168).default(24) });
export type Assumptions = z.infer<typeof assumptionsSchema>;
export const defaultAssumptions = assumptionsSchema.parse({});
const airportZone = "America/New_York";
const driveHome = (airport: string) => airport === "JFK" ? 75 : 30;
const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
export function datePairs(preferences: Preferences, flexible: boolean, now: string) {
  const start = Temporal.PlainDate.from(preferences.outboundDate), end = Temporal.PlainDate.from(preferences.returnDate);
  const today = Temporal.Instant.from(now).toZonedDateTimeISO(actualAirportZone(preferences.departureAirport)).toPlainDate();
  if (start.until(end).days < 1 || start.until(end).days > 35 || today.until(start).days < 0 || today.until(end).days > 330) throw new Error("Choose future dates for a 1–35 day trip within the next 330 days");
  const changes = flexible ? [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]] : [[0, 0]];
  return changes.map(([a, b]) => ({ outboundDate: start.add({ days: a! }).toString(), returnDate: end.add({ days: b! }).toString() })).filter((pair) => pair.outboundDate >= today.toString() && pair.returnDate > pair.outboundDate && Temporal.PlainDate.from(pair.outboundDate).until(pair.returnDate).days <= 35);
}
function segment(date: string, time: string, from: string, to: string, minutes: number, number: string) {
  const start = Temporal.Instant.from(localInstant(date, time, airportZone));
  return segmentSchema.parse({ flightNumber: `DEMO ${number}`, departureAirport: from, arrivalAirport: to, departsAt: start.toString(), arrivesAt: start.add({ minutes }).toString(), departureTimeZone: airportZone, arrivalTimeZone: airportZone });
}
function leg(date: string, time: string, from: string, to: string, connection: boolean, number: string) {
  const first = segment(date, time, from, connection ? "CLT" : to, connection ? 60 : 100, `${number}A`);
  if (!connection) return [first];
  const onward = Temporal.Instant.from(first.arrivesAt).add({ minutes: 60 }).toZonedDateTimeISO(airportZone);
  return [first, segment(onward.toPlainDate().toString(), onward.toPlainTime().toString({ smallestUnit: "minute" }), "CLT", to, 100, `${number}B`)];
}
export function demoInventory(ownerId: string, tripId: string, preferences: Preferences, pairs: ReturnType<typeof datePairs>, nearby: boolean, now: string): Offer[] {
  if (preferences.departureAirport !== "RDU" || !["EWR", "JFK"].includes(preferences.arrivalAirport)) return [];
  const destinations = nearby ? [preferences.arrivalAirport, preferences.arrivalAirport === "EWR" ? "JFK" : "EWR"] : [preferences.arrivalAirport];
  const templates = [
    { name: "midday", out: "13:00", back: "18:00", base: 6800, connection: false },
    { name: "morning", out: "08:00", back: "18:00", base: 11800, connection: false },
    { name: "after-classes", out: "20:00", back: "18:00", base: 13800, connection: false },
    { name: "early-return", out: "20:00", back: "06:00", base: 15800, connection: false },
    { name: "connection", out: "19:45", back: "06:00", base: 4800, connection: true },
  ];
  return pairs.flatMap((pair) => destinations.flatMap((destination) => templates.map((template, index) => {
    const dayCost = (date: string) => [5, 7].includes(Temporal.PlainDate.from(date).dayOfWeek) ? 2000 : 0;
    const outward = Math.round(template.base / 2) + dayCost(pair.outboundDate) + (destination === "JFK" ? 500 : 0), inward = template.base - Math.round(template.base / 2) + dayCost(pair.returnDate);
    const baggageFeeCents = preferences.baggage === "carry_on" ? 3000 : preferences.baggage === "checked_bag" ? 6000 : 0, totalCents = outward + inward + baggageFeeCents;
    const comparisonKey = `wing-demo-v1:RDU:${destination}:${pair.outboundDate}:${pair.returnDate}:${template.name}:${preferences.baggage}:economy:1`;
    const hash = createHash("sha256").update(comparisonKey).digest("hex"), mode = parseInt(hash.slice(0, 2), 16) % 3;
    const multipliers = mode === 0 ? [1.3, 1.2, 1.15, 1.18] : mode === 1 ? [0.99, 1.02, 1.04, 0.98] : [0.75, 0.8, 0.85, 0.82];
    return offerSchema.parse({ id: `demo_${hash.slice(0, 24)}`, version: 1, ownerId, tripId, inventoryVersion: "wing-demo-v1", airline: "DEMO Wing Air", comparisonKey,
      outbound: leg(pair.outboundDate, template.out, "RDU", destination, template.connection, `${index + 1}01`), inbound: leg(pair.returnDate, template.back, destination, "RDU", template.connection, `${index + 1}02`),
      totalCents, perPersonCents: totalCents, travelers: 1, outboundFareCents: outward, inboundFareCents: inward, baggageFeeCents, currency: "USD", cabin: "economy", baggage: `${preferences.baggage.replaceAll("_", " ")} included in this total; one traveler`, expiresAt: Temporal.Instant.from(now).add({ minutes: 15 }).toString(), simulated: true,
      priceHistory: [...multipliers.map((multiple, i) => ({ observedAt: Temporal.Instant.from(now).subtract({ hours: [21, 14, 7, 3][i]! * 24 }).toString(), totalCents: Math.round(totalCents * multiple), simulated: true })), { observedAt: now, totalCents, simulated: true }],
    });
  })));
}
export function priceContext(offer: Offer) {
  if (!offer.simulated) return { comparisonKey: offer.comparisonKey, simulated: false, currentCents: offer.totalCents, medianCents: null, level: "unknown", observations: offer.priceHistory };
  const prices = offer.priceHistory.slice(0, -1).map((point) => point.totalCents).sort((a, b) => a - b);
  const middle = Math.floor(prices.length / 2);
  const medianCents = prices.length % 2 ? prices[middle]! : Math.round((prices[middle - 1]! + prices[middle]!) / 2);
  return { comparisonKey: offer.comparisonKey, simulated: true, currentCents: offer.totalCents, medianCents, level: offer.totalCents <= medianCents * 0.9 ? "low" : offer.totalCents >= medianCents * 1.1 ? "high" : "typical", observations: offer.priceHistory };
}
export function journey(offer: Offer, assumptions: Assumptions) {
  const out = offer.outbound[0]!, arrival = offer.outbound.at(-1)!, back = offer.inbound[0]!, returned = offer.inbound.at(-1)!;
  const awayStart = Temporal.Instant.from(out.departsAt).subtract({ minutes: assumptions.airportBufferMinutes + assumptions.originDriveMinutes });
  const awayEnd = Temporal.Instant.from(returned.arrivesAt).add({ minutes: assumptions.landingBufferMinutes + assumptions.originDriveMinutes });
  const homeStart = Temporal.Instant.from(arrival.arrivesAt).add({ minutes: assumptions.landingBufferMinutes + driveHome(arrival.arrivalAirport) });
  const homeEnd = Temporal.Instant.from(back.departsAt).subtract({ minutes: assumptions.airportBufferMinutes + driveHome(back.departureAirport) });
  return { away: { start: awayStart.toString(), end: awayEnd.toString() }, homeStart: homeStart.toString(), homeEnd: homeEnd.toString(), homeHours: Math.max(0, homeEnd.since(homeStart).total("hours")) };
}
export const flightResultSchema = z.object({
  status: z.enum(["options", "no_results", "schedule_unknown", "unsupported_route"]),
  simulated: z.boolean().optional(),
  scheduleChecked: z.boolean().optional(),
  options: z.array(z.object({ offer: offerSchema, homeHours: z.number(), conflicts: z.array(z.string()), price: z.object({ comparisonKey: z.string(), simulated: z.boolean(), currentCents: z.number(), medianCents: z.number().nullable(), level: z.string(), observations: z.array(z.object({ observedAt: z.string(), totalCents: z.number(), simulated: z.boolean() })) }) })).max(3),
  rejected: z.array(z.object({ offerId: z.string(), totalCents: z.number(), reason: z.string(), conflicts: z.array(z.string()) })).max(60),
  assumptions: assumptionsSchema, calendarRefreshedAt: z.string().nullable(), datePairs: z.number().int().min(1).max(6),
});
export type FlightResult = z.infer<typeof flightResultSchema>;
export function rankFlights(inventory: Offer[], preferences: Preferences, windows: Window[], calendarHealthy: boolean, unknownSource: boolean, assumptions: Assumptions, now: string, refreshedAt: string | null, pairCount: number): FlightResult {
  const rejected: FlightResult["rejected"] = [], candidates: { offer: Offer; homeHours: number; conflicts: string[] }[] = [];
  for (const raw of inventory) {
    const offer = offerSchema.parse(raw), travel = journey(offer, assumptions), stops = offer.outbound.length + offer.inbound.length - 2;
    const overlapping = windows.filter((window) => window.kind === "class" || window.kind === "busy").filter((window) => Temporal.Instant.compare(window.start, travel.away.end) < 0 && Temporal.Instant.compare(window.end, travel.away.start) > 0);
    const conflicts = [...new Set(overlapping.map((window) => window.label))];
    let reason = "";
    if (Temporal.Instant.compare(offer.outbound[0]!.departsAt, now) <= 0 || Temporal.Instant.compare(offer.expiresAt, now) <= 0) reason = "past_or_expired";
    else if (preferences.nonstop && stops) reason = "nonstop_preference";
    else if ([offer.outbound[0]!, offer.inbound[0]!].some((leg) => { const clock = Temporal.Instant.from(leg.departsAt).toZonedDateTimeISO(leg.departureTimeZone).toPlainTime().toString({ smallestUnit: "minute" }); return (preferences.earliestDeparture && clock < preferences.earliestDeparture) || (preferences.latestDeparture && clock > preferences.latestDeparture); })) reason = "departure_time_preference";
    else if (travel.homeHours < assumptions.minimumHomeHours) reason = "too_little_time_home";
    else if (overlapping.some((window) => window.kind === "busy" || !preferences.allowMissedCommitments)) reason = "schedule_conflict";
    else if (unknownSource || (!calendarHealthy && availability(travel.away, windows.filter((window) => !preferences.allowMissedCommitments || window.kind !== "class"), false, false).some((slot) => slot.status === "unknown"))) reason = "schedule_unknown";
    if (reason) rejected.push({ offerId: offer.id, totalCents: offer.totalCents, reason, conflicts });
    else candidates.push({ offer, homeHours: travel.homeHours, conflicts });
  }
  const feasible = candidates.filter((candidate) => {
    const offer = candidate.offer;
    let reason = preferences.budgetMode === "hard_cap" && preferences.budgetCents !== null && offer.totalCents > preferences.budgetCents ? "budget" : "";
    if (!reason && offer.outbound.length + offer.inbound.length > 2 && preferences.minLayoverSavingsCents > 0) {
      const date = (leg: Offer["outbound"][number]) => Temporal.Instant.from(leg.departsAt).toZonedDateTimeISO(leg.departureTimeZone).toPlainDate().toString();
      const same = candidates.filter((other) => other.offer.outbound.length === 1 && other.offer.inbound.length === 1 && other.offer.outbound[0]!.arrivalAirport === offer.outbound.at(-1)!.arrivalAirport && date(other.offer.outbound[0]!) === date(offer.outbound[0]!) && date(other.offer.inbound[0]!) === date(offer.inbound[0]!));
      if (!same.length || Math.min(...same.map((other) => other.offer.totalCents)) - offer.totalCents < preferences.minLayoverSavingsCents) reason = "layover_savings";
    }
    if (reason) rejected.push({ offerId: offer.id, totalCents: offer.totalCents, reason, conflicts: candidate.conflicts });
    return !reason;
  });
  const mostHome = Math.max(0, ...feasible.map((candidate) => candidate.homeHours));
  const score = (candidate: typeof candidates[number]) => candidate.offer.totalCents / 100 + (preferences.budgetMode === "cheapest" ? 0 : (candidate.offer.outbound.length + candidate.offer.inbound.length - 2) * 20 + (mostHome - candidate.homeHours) * 0.75 + (/before dinner/i.test(preferences.arrivalPreference || "") && Temporal.Instant.from(journey(candidate.offer, assumptions).homeStart).toZonedDateTimeISO(candidate.offer.outbound.at(-1)!.arrivalTimeZone).hour >= 18 ? 35 : 0));
  feasible.sort((a, b) => score(a) - score(b) || a.offer.id.localeCompare(b.offer.id));
  const selected = feasible.slice(0, 3), alternative = feasible.find((candidate) => candidate.offer.outbound.at(-1)!.arrivalAirport !== preferences.arrivalAirport);
  if (alternative && !selected.some((candidate) => candidate.offer.id === alternative.offer.id)) selected.splice(2, 1, alternative);
  return flightResultSchema.parse({ simulated: inventory.every((offer) => offer.simulated), status: feasible.length ? "options" : !inventory.length ? "unsupported_route" : rejected.some((item) => item.reason === "schedule_unknown") ? "schedule_unknown" : "no_results", options: selected.map((candidate) => ({ ...candidate, price: priceContext(candidate.offer) })), rejected: rejected.sort((a, b) => a.totalCents - b.totalCents).slice(0, 60), assumptions, calendarRefreshedAt: refreshedAt, datePairs: pairCount });
}
export function briefFlightAnswer(offer: Offer, question: string): string | null {
  // A one-word answer is safe only for a single, unqualified question with explicit offer evidence.
  question = question.replaceAll("’", "'");
  if (/\b(and|or|but|why|how|which|what|not|no|don't|doesn't|isn't|aren't|without|extra|fee|cost|add|change|switch|book)\b/i.test(question)) return null;
  if (/\b(?:is|are|does|do)\b|\?/i.test(question) && /\bnon[ -]?stop\b/i.test(question)) return offer.outbound.length + offer.inbound.length === 2 ? "yup" : "nope";
  if (!offer.simulated) return /\b(carry[ -]?on|checked bag|personal item)\b/i.test(question) ? "bag allowance isn't confirmed for this fare" : null;
  const asked = question.match(/\b(carry[ -]?on|checked bag|personal item)\b/i)?.[1]?.toLowerCase().replace(/[ -]/g, "");
  if (!asked || !/\b(include[ds]?|comes? with)\b/i.test(question)) return null;
  const included = offer.baggage.split(" included")[0]!.toLowerCase().replace(/[ -]/g, "");
  if (asked === included) return "yup";
  if (included === "personalitem" || (asked === "checkedbag" && included === "carryon")) return "nope";
  return null;
}

export function legText(first: Offer["outbound"][number], last: Offer["outbound"][number]) {
  const start = Temporal.Instant.from(first.departsAt).toZonedDateTimeISO(first.departureTimeZone), end = Temporal.Instant.from(last.arrivesAt).toZonedDateTimeISO(last.arrivalTimeZone);
  const day = (instant: string, zone: string) => new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(instant));
  const clock = (instant: string, zone: string) => new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(instant)).replace(":00", "").replace(" AM", "am").replace(" PM", "pm");
  const zoneName = (instant: string, zone: string) => new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" }).formatToParts(new Date(instant)).find((part) => part.type === "timeZoneName")!.value;
  if (start.toPlainDate().equals(end.toPlainDate()) && first.departureTimeZone === last.arrivalTimeZone && start.offset === end.offset) return `${day(first.departsAt, first.departureTimeZone)} · ${clock(first.departsAt, first.departureTimeZone)}–${clock(last.arrivesAt, last.arrivalTimeZone)} ${zoneName(first.departsAt, first.departureTimeZone)}`;
  return `${day(first.departsAt, first.departureTimeZone)}, ${clock(first.departsAt, first.departureTimeZone)} ${zoneName(first.departsAt, first.departureTimeZone)} → ${day(last.arrivesAt, last.arrivalTimeZone)}, ${clock(last.arrivesAt, last.arrivalTimeZone)} ${zoneName(last.arrivesAt, last.arrivalTimeZone)}`;
}
export function presentedFlights(result: FlightResult, text: string, nearby = false): FlightResult {
  // Persist only displayed choices so "book that one" cannot select a hidden offer.
  if (/\b(options|alternatives|choices|more|else|compare|list|all)\b/i.test(text)) return result;
  if (nearby) return { ...result, options: result.options.filter((option, i, choices) => choices.findIndex((other) => other.offer.outbound.at(-1)!.arrivalAirport === option.offer.outbound.at(-1)!.arrivalAirport) === i) };
  return { ...result, options: result.options.slice(0, 1) };
}
export function departureText(segment: Offer["outbound"][number], arrival = false) {
  return new Intl.DateTimeFormat("en-US", { timeZone: arrival ? segment.arrivalTimeZone : segment.departureTimeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(arrival ? segment.arrivesAt : segment.departsAt)).replace(", ", " at ").replace(":00", "").replace(" AM", "am").replace(" PM", "pm");
}
export function formatFlights(result: FlightResult, title: string, previous?: FlightResult) {
  const live = result.simulated === false, tag = live ? "" : " (simulated prices)";
  const unchecked = result.scheduleChecked === false ? "\n\nschedule not checked, calendar isn't connected" : "";
  if (result.status === "unsupported_route") return live ? "no verified round-trip flights came back — try other dates or airports?" : "the simulated inventory only supports RDU ↔ EWR/JFK";
  if (result.status === "schedule_unknown") return "can't verify your schedule yet — can you reconnect or confirm those dates?";
  const first = result.options[0];
  const blocked = result.rejected.find((item) => item.reason === "schedule_conflict" && (!first || item.totalCents < first.offer.totalCents));
  const explanation = blocked ? `\n${money(blocked.totalCents)} overlaps ${blocked.conflicts.slice(0, 1).join(", ")}${blocked.conflicts.length > 1 ? " and other commitments" : ""}` : "";
  if (!first) return `nothing fits your dates, budget and commitments${tag}${explanation}\n\ncan your dates change?`;
  const route = (offer: Offer) => `${offer.outbound[0]!.departureAirport} ↔ ${offer.outbound.at(-1)!.arrivalAirport}`;
  const stops = (offer: Offer) => offer.outbound.length + offer.inbound.length === 2 ? "nonstop" : [offer.outbound.length > 1 ? `out via ${offer.outbound.slice(0, -1).map((leg) => leg.arrivalAirport).join(", ")}` : "nonstop out", offer.inbound.length > 1 ? `back via ${offer.inbound.slice(0, -1).map((leg) => leg.arrivalAirport).join(", ")}` : "nonstop back"].join(" · ");
  const bag = live ? first.offer.baggage.replace("carry on", "carry-on") : first.offer.baggage.split(" included")[0]!.replace("carry on", "carry-on");
  const when = (segments: Offer["outbound"]) => {
    const first = segments[0]!, last = segments.at(-1)!;
    const out = Temporal.Instant.from(first.departsAt).toZonedDateTimeISO(first.departureTimeZone), end = Temporal.Instant.from(last.arrivesAt).toZonedDateTimeISO(last.arrivalTimeZone);
    return `${departureText(first)}${out.toPlainDate().equals(end.toPlainDate()) && first.departureTimeZone === last.arrivalTimeZone && out.offset === end.offset ? "" : ` (lands ${departureText(last, true)})`}`;
  };
  const permission = first.conflicts.length ? `\nmisses ${first.conflicts.join(", ")} with your permission` : "";
  if (result.options.length > 1) {
    const times = (offer: Offer) => [...offer.outbound, ...offer.inbound].map((segment) => [segment.departsAt, segment.arrivesAt, segment.departureTimeZone, segment.arrivalTimeZone]);
    const lines = result.options.map(({ offer, conflicts }, i) => {
      const sameTimes = i > 0 && JSON.stringify(times(offer)) === JSON.stringify(times(first.offer));
      const timing = sameTimes ? "same flight times" : `out ${when(offer.outbound)} · back ${when(offer.inbound)}`;
      const differentAirport = offer.outbound.at(-1)!.arrivalAirport !== first.offer.outbound.at(-1)!.arrivalAirport;
      return `${i + 1} · ${money(offer.totalCents)} · ${route(offer)} · ${stops(offer)}\n${timing}${differentAirport ? ` · ~${driveHome(offer.outbound.at(-1)!.arrivalAirport)}min home drive (estimate)` : ""}${conflicts.length ? `\nmisses ${conflicts.join(", ")} (with your permission)` : ""}`;
    });
    return `i'd pick 1! these are round-trip prices${tag}\n\n${lines.join("\n\n")}\n\nwhich one? just reply with its number${unchecked}`;
  }
  const before = previous?.options[0]?.offer, offer = first.offer;
  if (before && route(before) === route(offer) && stops(before) === stops(offer)) {
    const outChanged = JSON.stringify(before.outbound) !== JSON.stringify(offer.outbound), backChanged = JSON.stringify(before.inbound) !== JSON.stringify(offer.inbound);
    const change = [outChanged ? `leave ${when(offer.outbound)}` : "", backChanged ? `back ${when(offer.inbound)}` : ""].filter(Boolean).join("; ");
    const bagChanged = before.baggage !== offer.baggage;
    return `${change || "same flight still looks best"}\n${money(offer.totalCents)} round trip${tag}${bagChanged ? ` · ${bag}${live ? "" : " included"}` : ""}${permission}${unchecked}`;
  }
  return `i found one on ${when(offer.outbound)} for ${money(offer.totalCents)} round trip${tag}\n${route(offer)} · ${stops(offer)}\nback ${when(offer.inbound)}${permission}${unchecked}`;
}
