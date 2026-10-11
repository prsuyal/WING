import { z } from "zod";

// Legacy developer commands use this; normal chat supplies Claude interpretation.
export function isYes(text: string) {
  return /^(yes+|yea+h*|ya|yep+|yup+|sure|ok(?:ay)?|go ahead|do it|book it|confirm|approved|sounds good|looks good|let'?s do it|👍(?:🏻|🏼|🏽|🏾|🏿)?)(?:[,\s]+(?:please|book(?: it)?|do it|go ahead|let'?s do it|thanks|thank you))*[!.\s]*$/iu.test(text.trim().replaceAll("’", "'"));
}

export async function understands(actor: Actor, request: string, legacy: boolean) {
  return actor.interpret ? actor.interpret(request) : legacy;
}

export async function naturalText(actor: Actor, facts: string, kind: "review" | "confirmation" | "search" | "details" = "review") {
  return actor.present ? actor.present(facts, kind) : facts;
}

function validZone(zone: string) {
  if (zone !== "UTC" && !zone.includes("/")) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: zone }); return true; } catch { return false; }
}

export const messageBodySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(32_000) }),
  z.object({ type: z.literal("attachment"), mimeType: z.string().startsWith("image/"), name: z.string().max(512), size: z.number().int().nonnegative().optional(), storagePath: z.string().optional() }),
]);
export const receivedSchema = z.object({ userId: z.uuid(), messageId: z.uuid(), isNew: z.boolean() });
export type Received = z.infer<typeof receivedSchema>;
export type Actor = { userId: string; sourceMessageId: string; namespace: string; sourceText: string; replyInFlight?: boolean; interpret?: (request: string) => Promise<boolean>; present?: (facts: string, kind: "review" | "confirmation" | "search" | "details") => Promise<string> };

export const tripSchema = z.object({
  id: z.uuid(), ownerId: z.uuid(), version: z.number().int().positive(), title: z.string().min(1),
  status: z.enum(["planning", "selected", "booked", "traveling", "home", "cancelled"]),
  departureAirport: z.string().regex(/^[A-Z]{3}$/), arrivalAirport: z.string().regex(/^[A-Z]{3}$/),
  outboundDate: z.iso.date(), returnDate: z.iso.date(), timeZone: z.string().min(1),
});
export const segmentSchema = z.object({
  flightNumber: z.string().min(2).max(50), departureAirport: z.string().regex(/^[A-Z]{3}$/), arrivalAirport: z.string().regex(/^[A-Z]{3}$/),
  departsAt: z.iso.datetime({ offset: true }), arrivesAt: z.iso.datetime({ offset: true }), departureTimeZone: z.string().refine(validZone), arrivalTimeZone: z.string().refine(validZone),
}).strict().refine((segment) => Date.parse(segment.arrivesAt) > Date.parse(segment.departsAt), "A flight must arrive after it departs");
export const offerSchema = z.object({
  id: z.string(), version: z.number().int().positive(), tripId: z.uuid(), ownerId: z.uuid(),
  outbound: z.array(segmentSchema).min(1), inbound: z.array(segmentSchema).min(1),
  totalCents: z.number().int().nonnegative(), currency: z.literal("USD"), cabin: z.literal("economy"),
  baggage: z.string(), expiresAt: z.iso.datetime(), simulated: z.boolean(),
  airline: z.string().min(1), inventoryVersion: z.enum(["wing-demo-v1", "serpapi-v1"]),
  outboundFareCents: z.number().int().nonnegative().nullable(), inboundFareCents: z.number().int().nonnegative().nullable(), baggageFeeCents: z.number().int().nonnegative().nullable(),
  perPersonCents: z.number().int().nonnegative(), travelers: z.literal(1),
  comparisonKey: z.string(),
  priceHistory: z.array(z.object({ observedAt: z.iso.datetime(), totalCents: z.number().int().nonnegative(), simulated: z.boolean() })).min(1).max(10),
}).strict().refine((offer) => offer.totalCents === offer.perPersonCents && (offer.simulated
  ? offer.inventoryVersion === "wing-demo-v1" && offer.airline.startsWith("DEMO") && [...offer.outbound, ...offer.inbound].every((segment) => segment.flightNumber.startsWith("DEMO")) && offer.priceHistory.length >= 3 && offer.priceHistory.every((point) => point.simulated) && offer.outboundFareCents !== null && offer.inboundFareCents !== null && offer.baggageFeeCents !== null && offer.totalCents === offer.outboundFareCents + offer.inboundFareCents + offer.baggageFeeCents
  : offer.inventoryVersion === "serpapi-v1" && offer.priceHistory.every((point) => !point.simulated) && offer.outboundFareCents === null && offer.inboundFareCents === null && offer.baggageFeeCents === null), "Keep real quotes separate from simulated fare breakdowns").refine((offer) => {
  const coherent = (legs: z.infer<typeof segmentSchema>[]) => legs.every((leg, i) => !i || (legs[i - 1]!.arrivalAirport === leg.departureAirport && Date.parse(leg.departsAt) - Date.parse(legs[i - 1]!.arrivesAt) >= 30 * 60_000));
  return coherent(offer.outbound) && coherent(offer.inbound) && offer.outbound.at(-1)!.arrivalAirport === offer.inbound[0]!.departureAirport && offer.outbound[0]!.departureAirport === offer.inbound.at(-1)!.arrivalAirport && Date.parse(offer.outbound.at(-1)!.arrivesAt) < Date.parse(offer.inbound[0]!.departsAt);
}, "Round trips must connect in order with usable layovers and matching airports").refine((offer) => offer.priceHistory.at(-1)!.totalCents === offer.totalCents && offer.priceHistory.every((point, index) => !index || Date.parse(point.observedAt) > Date.parse(offer.priceHistory[index - 1]!.observedAt)), "Price observations must be chronological and end at the quoted price");
export const actionSchema = z.object({
  id: z.uuid(), ownerId: z.uuid(), tripId: z.uuid(), offerId: z.string(), offerVersion: z.number().int().positive(),
  totalCents: z.number().int().nonnegative(), status: z.enum(["review", "approved", "processing", "confirmed", "failed", "unknown"]),
});
export interface DemoFlightProvider {
  search(trip: z.infer<typeof tripSchema>): Promise<z.infer<typeof offerSchema>[]>;
  book(action: z.infer<typeof actionSchema>): Promise<{ reference: string; simulated: true; status: "confirmed" | "failed" | "unknown" }>;
}
