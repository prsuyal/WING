import { tool } from "ai";
import { z } from "zod";
import type { Actor } from "./contracts.ts";
import type { Journeys } from "./journey.ts";

export function createJourneyTools(journeys: Journeys, actor: Actor, display: (message: string) => void) {
  async function show(run: () => Promise<string>) {
    try { const message = await run(); display(message); return { message }; }
    catch (error) {
      const reason = error instanceof z.ZodError ? "invalid_terms" : ["Journey changed", "Choose a specific trip", "Book a flight", "Pickup changed", "Ride terms changed", "Calendar selection changed", "Booking scope", "Booking not verified", "Existing event differs"].find((prefix) => error instanceof Error && error.message.startsWith(prefix)) ?? "unavailable";
      console.error(JSON.stringify({ event: "journey_tool_failed", reason }));
      const message = error instanceof Error && /Connect Google|Choose exactly one|Reconnect with/.test(error.message) ? `${error.message.toLowerCase()} — say connect my calendar or show my calendars` : "couldn't check that trip yet, ask me to check its status";
      display(message); return { message };
    }
  }
  return {
    propose_airport_ride: tool({ description: "After a confirmed flight reservation, help with an airport ride. Both real flight quotes and synthetic inventory support a simulated future airport pickup. Always explain this is simulated; no real Uber ride, driver or charge. Resolves saved consented campus address or current trip pickup override, derives pickup from the approved flight's driving and airport buffers, and displays exact route/time/fare/demo payment review. No reservation until a separate yes. If the current message gives an exact pickup address, pass temporaryPickup here: it is saved for just this trip before producing the review. Do not separately call set_pickup_override at the same time. If missing pickup, asks for a street address. Never infer an address from memory. Does not dispatch anyone.", inputSchema: z.object({ reference: z.string().optional(), temporaryPickup: z.string().trim().min(5).max(500).optional() }), execute: ({ reference, temporaryPickup }) => show(() => journeys.proposeRide(actor, reference, temporaryPickup)) }),
    propose_calendar_reminders: tool({ description: "Only when explicitly asked for calendar reminders: show a separate exact review for two real private [DEMO] popup reminders on the booked trip. No write until a separate yes after this review. Reuses journey approval and stable event IDs; never edits existing flight events.", inputSchema: z.object({ reference: z.string().optional() }).strict(), execute: ({ reference }) => show(() => journeys.proposeItinerary(actor, reference, true)) }),
    propose_itinerary: tool({ description: "When requested, review real [DEMO] Google events for the booked flight and any confirmed ride. Uses exactly one selected owned calendar. Shows all dates/times/calendar name and simulation notice. No writes until a separate yes after the exact review. Flight/ride approval is not calendar consent. A ride is optional; add flight events alone if requested. Retry unresolved actions by their same ID, never start another to bypass uncertainty.", inputSchema: z.object({ reference: z.string().optional() }), execute: ({ reference }) => show(() => journeys.proposeItinerary(actor, reference)) }),
    decline_journey: tool({ description: "Decline the pending ride or calendar review when requested. Never removes created events or cancels confirmed reservations.", inputSchema: z.object({ id: z.uuid() }), execute: ({ id }) => show(() => journeys.decline(actor, id)) }),
    approve_journey: tool({ description: "Approve the exact delivered ride or calendar review with a separate clear yes/ya/yup. Backend binds sender, trip, terms, source and delivery. Saves one demo ride or writes/readbacks approved real [DEMO] calendar events. No real ride/payment/dispatch. Do not call from a selection or review request.", inputSchema: z.object({ id: z.uuid() }), execute: ({ id }) => show(() => journeys.approve(actor, id)) }),
    review_journey: tool({ description: "Read a ride/calendar outcome or re-present its existing exact review for retry/reconciliation. Confirmed means already completed, never pending approval. Read a confirmed simulated airport pickup for either real or synthetic flight quotes. Never claim success unless returned by the tool.", inputSchema: z.object({ kind: z.enum(["ride", "itinerary"]), reference: z.string().optional() }), execute: ({ kind, reference }) => show(() => journeys.review(actor, kind, reference)) }),
  };
}
