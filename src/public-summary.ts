import { z } from "zod";

// Shared browser-safe allowlist. Keep persistence and private records outside this module.
export const shareTokenPattern = /^[A-Za-z0-9_-]{43}$/;
export const publicSummarySchema = z
  .object({
    displayName: z.string().max(80),
    status: z.literal("planning"),
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
    simulated: z.literal(true),
  })
  .strict();
export type PublicSummary = z.infer<typeof publicSummarySchema>;
