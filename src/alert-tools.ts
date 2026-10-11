import { tool } from "ai";
import { z } from "zod";
import type { Actor } from "./contracts.ts";
import { watchInputSchema, type Alerts } from "./alerts.ts";
export function createAlertTools(alerts: Alerts, actor: Actor, display: (text: string) => void) {
  async function show(run: () => Promise<string>) {
    try { const message = await run(); display(message); return { message }; }
    catch (error) {
      const message = error instanceof Error && error.message.startsWith("Choose a specific trip") ? "which trip do you mean?" : error instanceof Error && /State the|Notification consent|Ask to|No active watch|Book a flight/.test(error.message) ? error.message.toLowerCase() : "couldn't check those alerts yet — try /check-trip";
      display(message); return { message };
    }
  }
  return {
    watch_prices: tool({ description: "Watch one displayed, schedule-fitting itinerary on an unbooked trip. Comparison is the same dates/route/baggage/traveler/cabin, never unrelated fares. A target requires a user-stated total in cents. A drop watch defaults to $20. If several options, user must specify the one to watch. notify=true only when the current message explicitly asks to text/notify/alert/tell them. Otherwise asks once for notification consent. No auto-booking. Price sources follow the displayed quote: real quotes use real provider prices, legacy synthetic inventory stays simulated. Ordinary recurring checks run every six hours.", inputSchema: watchInputSchema, execute: (input) => show(() => alerts.createWatch(actor, input)) }),
    enable_price_alerts: tool({ description: "Enable future price alert texts only when the user agrees to the last delivered watch consent question. Backend binds the actual watch, owner, source and delivered consent question. This is not flight or calendar approval.", inputSchema: z.object({}), execute: () => show(async () => await alerts.enableNotifications(actor) ?? "show me the watch first so i can confirm what to text you about") }),
    check_trip: tool({ description: "Read this user's referenced trip or refresh its watched itinerary now. Replies are on-demand, so quiet hours/cooldown do not block them. Calendar failure is unknown, never free. Booked trips cannot acquire a new price watch or another reservation.", inputSchema: z.object({ reference: z.string().optional() }), execute: ({ reference }) => show(() => alerts.check(actor, reference)) }),
    stop_alerts: tool({ description: "Persist an explicit stop/mute/pause request. With reference, cancels only this trip's watch and text reminders. Without reference, stops all future alerts and text reminders for this sender. Does not cancel bookings, delete calendars or revoke Google. A new explicit watch/reminder request is required to resume.", inputSchema: z.object({ reference: z.string().optional() }), execute: ({ reference }) => show(() => alerts.stop(actor, reference)) }),
    set_text_reminders: tool({ description: "After the user explicitly asks for text reminders on a booked trip, schedule both travel days using the persisted flight and approved pickup times. Default outbound reminder is 30 minutes before approved pickup (or 3 hours before departure without a ride); return reminder is 3 hours before departure. Delivery obeys 10pm–8am quiet hours and one proactive text per 24 hours. Early flights get a 9:30pm heads-up the evening before if the normal reminder would fall in quiet hours. Expired reminders never fire late. No calendar write; use calendar reminder review tool when requested.", inputSchema: z.object({ reference: z.string().optional() }), execute: ({ reference }) => show(() => alerts.reminders(actor, reference)) }),
  };
}
