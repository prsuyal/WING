import { tool } from "ai";
import { z } from "zod";
import { naturalText, type Actor } from "./contracts.ts";
import { flightQuerySchema, type FlightPlanner } from "./flight-store.ts";
import { FlightSearchError } from "./live-flights.ts";

export function createFlightTools(planner: FlightPlanner, actor: Actor, display: (message: string) => void) {
  return {
    search_flights: tool({ description: "Search real round-trip flight quotes (or labeled test inventory) for the referenced trip, using its confirmed preferences and refreshed real schedule. Application code filters and ranks; never invent offers/prices. First persist user-stated date/preference changes with update_trip. Flexible dates and nearby airports require the user's current explicit request. No booking or payment occurs.", inputSchema: flightQuerySchema, execute: async (input) => {
      try { const result = await planner.search(actor, input); const message = await naturalText(actor, result.message, "search"); await planner.presentation(actor, message); display(message); return { ...result, message }; }
      catch (error) { const message = error instanceof FlightSearchError ? error.message : "search didn't finish — check the trip dates and airports, then try again"; display(message); return { message }; }
    } }),
    flight_details: tool({ description: "Read the currently displayed, owner-bound flight for follow-up questions about baggage, times, price, connections or travel buffers. No new search or booking. Answer only the question asked; full itinerary only if requested. Never read a hidden or expired option.", inputSchema: z.object({ option: z.number().int().min(1).max(3).default(1), reference: z.string().optional() }), execute: async ({ option, reference }) => {
      const saved = await planner.latest(actor, reference);
      if (!saved.result) return { message: saved.message };
      const selected = saved.result.options[option - 1];
      if (!selected) return { message: "which flight?" };
      return { ...selected, rejected: saved.result.rejected, assumptions: saved.result.assumptions, simulated: selected.offer.simulated };
    } }),
    compare_prices: tool({ description: "Compare a displayed option (1–3) with the same itinerary's verified price observations; real quotes may not have enough history. Backend checks owner, trip, preference versions and expiry. Never describe a different itinerary as the same flight getting cheaper.", inputSchema: z.object({ option: z.number().int().min(1).max(3), reference: z.string().optional() }), execute: async ({ option, reference }) => {
      try { const result = await planner.compare(actor, option, reference); const message = await naturalText(actor, result.message, "details"); display(message); return { ...result, message }; }
      catch { const message = "that price expired — search again?"; display(message); return { message }; }
    } }),
  };
}
