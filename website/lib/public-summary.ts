import { z } from "zod";

// Shared browser-safe allowlist. Keep persistence and private records outside this module.
export const shareTokenPattern = /^[A-Za-z0-9_-]{43}$/;
const zoneSchema = z.string().refine((zone) => {
  try { new Intl.DateTimeFormat("en", { timeZone: zone }); return true; } catch { return false; }
});
export const publicFlightSchema = z.object({
  flightNumber: z.string().min(2).max(50),
  departureAirport: z.string().regex(/^[A-Z]{3}$/),
  arrivalAirport: z.string().regex(/^[A-Z]{3}$/),
  departureName: z.string(), arrivalName: z.string(),
  departureCity: z.string(), arrivalCity: z.string(),
  departsAt: z.iso.datetime({ offset: true }), arrivesAt: z.iso.datetime({ offset: true }),
  departureTimeZone: zoneSchema, arrivalTimeZone: zoneSchema,
}).strict();
export const publicBookingSchema = z.object({
  airline: z.string(), cabin: z.literal("economy"), baggage: z.string(),
  outbound: z.array(publicFlightSchema).min(1), inbound: z.array(publicFlightSchema).min(1),
  simulated: z.literal(true),
}).strict();
export const publicRideSchema = z.object({
  provider: z.literal("Uber"), status: z.literal("reserved"),
  pickupLabel: z.enum(["Campus pickup", "Home pickup", "Trip pickup"]),
  airport: z.string().regex(/^[A-Z]{3}$/),
  pickupAt: z.iso.datetime({ offset: true }), airportAt: z.iso.datetime({ offset: true }),
  timeZone: zoneSchema, simulated: z.literal(true),
}).strict();
export type PublicFlight = z.infer<typeof publicFlightSchema>;
export const publicSummarySchema = z
  .object({
    displayName: z.string().max(80),
    status: z.enum(["planning", "booked"]),
    departureAirport: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    arrivalAirport: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    outboundDate: z.iso.date().nullable(),
    returnDate: z.iso.date().nullable(),
    updatedAt: z.iso.datetime({ offset: true }),
    booking: publicBookingSchema.optional(),
    ride: publicRideSchema.optional(),
    simulated: z.literal(true),
  })
  .strict().refine((summary) => summary.status === "booked" ? !!summary.booking : !summary.booking && !summary.ride, "Booked summaries require verified flight details");
export type PublicSummary = z.infer<typeof publicSummarySchema>;
