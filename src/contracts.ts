import { z } from "zod";

export const messageBodySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(32_000) }),
  z.object({ type: z.literal("attachment"), mimeType: z.string().startsWith("image/"), name: z.string().max(512), size: z.number().int().nonnegative().optional(), storagePath: z.string().optional() }),
]);
export const receivedSchema = z.object({ userId: z.uuid(), messageId: z.uuid(), isNew: z.boolean() });
export type Received = z.infer<typeof receivedSchema>;
export type Actor = { userId: string; sourceMessageId: string; namespace: string; sourceText: string };

export const tripSchema = z.object({
  id: z.uuid(), ownerId: z.uuid(), version: z.number().int().positive(), title: z.string().min(1),
  status: z.enum(["planning", "selected", "booked", "traveling", "home", "cancelled"]),
  departureAirport: z.string().regex(/^[A-Z]{3}$/), arrivalAirport: z.string().regex(/^[A-Z]{3}$/),
  outboundDate: z.iso.date(), returnDate: z.iso.date(), timeZone: z.string().min(1),
});
export const segmentSchema = z.object({
  flightNumber: z.string().startsWith("DEMO"), departureAirport: z.string().regex(/^[A-Z]{3}$/), arrivalAirport: z.string().regex(/^[A-Z]{3}$/),
  departsAt: z.iso.datetime({ offset: true }), arrivesAt: z.iso.datetime({ offset: true }), departureTimeZone: z.string(), arrivalTimeZone: z.string(),
});
export const offerSchema = z.object({
  id: z.string(), version: z.number().int().positive(), tripId: z.uuid(), ownerId: z.uuid(),
  outbound: z.array(segmentSchema).min(1), inbound: z.array(segmentSchema).min(1),
  totalCents: z.number().int().nonnegative(), currency: z.literal("USD"), cabin: z.literal("economy"),
  baggage: z.string(), expiresAt: z.iso.datetime(), simulated: z.literal(true),
});
export const actionSchema = z.object({
  id: z.uuid(), ownerId: z.uuid(), tripId: z.uuid(), offerId: z.string(), offerVersion: z.number().int().positive(),
  totalCents: z.number().int().nonnegative(), status: z.enum(["review", "approved", "processing", "confirmed", "failed", "unknown"]),
});
export interface DemoFlightProvider {
  search(trip: z.infer<typeof tripSchema>): Promise<z.infer<typeof offerSchema>[]>;
  book(action: z.infer<typeof actionSchema>): Promise<{ reference: string; simulated: true; status: "confirmed" | "failed" | "unknown" }>;
}
