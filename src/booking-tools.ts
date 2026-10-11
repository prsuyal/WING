import { tool } from "ai";
import { z } from "zod";
import type { Actor } from "./contracts.ts";
import type { Bookings } from "./booking.ts";

export function createBookingTools(bookings: Bookings, actor: Actor, display: (message: string) => void) {
  async function show(run: () => Promise<string>) {
    try { const message = await run(); display(message); return { message }; }
    catch (error) {
      const message = error instanceof Error && error.message.startsWith("which option") ? error.message : "couldn't finish that booking, ask me to check its status";
      display(message); return { message };
    }
  }
  return {
    booking_details: tool({ description: "Read the verified, owner-bound confirmed demo reservation to answer questions about times, baggage, route or price after booking. Answer only what was asked. No booking, approval or changes. To check whether booking completed, use review_booking instead.", inputSchema: z.object({ reference: z.string().optional() }), execute: async ({ reference }) => {
      const details = await bookings.details(actor, reference);
      return details;
    } }),
    select_flight: tool({ description: "Select a currently displayed option only when the user chooses it. Backend binds the number to the user's current message and persisted list. Shows an exact simulated booking review including both legs, baggage, total and simulation notice; selection never books. Multiple options plus 'this one' is ambiguous.", inputSchema: z.object({ option: z.number().int().min(1).max(3).optional(), reference: z.string().optional() }), execute: ({ option, reference }) => show(() => bookings.select(actor, option, reference)) }),
    decline_flight: tool({ description: "Decline the pending booking review when requested. Never cancels a confirmed reservation.", inputSchema: z.object({ id: z.uuid() }), execute: ({ id }) => show(() => bookings.decline(actor, id)) }),
    approve_flight: tool({ description: "Create one simulated reservation after a separate explicit yes to the exact current delivered review. Backend validates ownership, version, total, expiry, fresh calendar and approval provenance. Cannot approve from memory or the selection message. Provider uncertainty must be reconciled by the same action ID; no real charge or ticket.", inputSchema: z.object({ id: z.uuid() }), execute: ({ id }) => show(() => bookings.approve(actor, id)) }),
    review_booking: tool({ description: "Read back a confirmed demo reservation or present an existing exact review for reapproval/reconciliation. Never create another action to retry a processing or uncertain booking.", inputSchema: z.object({ reference: z.string().optional() }), execute: ({ reference }) => show(() => bookings.review(actor, reference)) }),
  };
}
