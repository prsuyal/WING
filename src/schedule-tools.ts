import { tool } from "ai";
import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import type { Actor } from "./contracts.ts";
import type { Calendar } from "./calendar.ts";
import { formatCalendarChoices } from "./calendar.ts";
import { availability, expandSchedule, planningRange, reconcileSchedule, scheduleSchema, zoneSchema } from "./schedule.ts";
import { formatSchedule, type ScheduleStore, type SavedSchedule } from "./schedule-store.ts";

export type ScheduleServices = { calendar: Calendar; schedules: ScheduleStore };
export function createScheduleTools(services: ScheduleServices, actor: Actor, review: (text: string) => void) {
  const { calendar, schedules } = services;
  return {
    connect_calendar: tool({ description: "Create an owner-bound Google Calendar sign-in link only when the user asks to connect. No calendar is selected and no event is created by signing in.", inputSchema: z.object({}), execute: async () => ({ privateConnectionUrl: await calendar.link(actor), expiresInMinutes: 20 }) }),
    list_calendars: tool({ description: "Show the user's accessible Google calendars and ask for a number or name. Use when they say done after sign-in or ask to see calendars. No slash commands needed.", inputSchema: z.object({}), execute: async () => { const message = formatCalendarChoices(await calendar.calendars(actor.userId)); review(message); return { message }; } }),
    select_calendars: tool({ description: "Select only the calendars the user chose, by exact name, ID or displayed number. A reply like 7 selects item 7 on the delivered list. This permits reading, not writing events.", inputSchema: z.object({ references: z.array(z.string()).min(1).max(5) }), execute: async ({ references }) => { const selected = await calendar.select(actor, references); return selected; } }),
    disconnect_calendar: tool({ description: "Disconnect when the user explicitly asks. Availability becomes unknown; saved events are never deleted.", inputSchema: z.object({}), execute: () => calendar.disconnect(actor) }),
    save_schedule_candidate: tool({ description: "Stage explicit user-provided schedule or availability as a candidate. Ask for dates/year and IANA time zone if unknown. A separate preview and confirmation are required. Empty screenshot cells never mean available. Monday=1, Sunday=7; spanDays describes explicit overnight/multi-day blocks.", inputSchema: z.object({ data: scheduleSchema }), execute: async ({ data }) => {
      const saved = await schedules.stage(actor, data, "text"); review(formatSchedule(saved)); return { candidateId: saved.id, version: saved.version, preview: formatSchedule(saved) };
    } }),
    revise_schedule: tool({ description: "Apply the user's clarification to a specific schedule candidate/current schedule. Preserve known blocks; clear notes only when resolved. Editing returns it to candidate state and displays a fresh preview.", inputSchema: z.object({ id: z.uuid(), version: z.number().int().positive(), patch: scheduleSchema.partial().strict() }), execute: async ({ id, version, patch }) => {
      const current = (await schedules.state(actor.userId)).find((row) => row.id === id);
      if (!current) throw new Error("Schedule candidate unavailable");
      let data = scheduleSchema.parse({ ...current.data, ...patch });
      if (data.timeZone && data.startDate && data.endDate && Temporal.PlainDate.from(data.startDate).until(data.endDate).days <= 89) {
        const synced = await calendar.sync(actor.userId, planningRange(data.startDate, data.endDate, data.timeZone));
        data = reconcileSchedule(data, synced.healthy ? synced.windows : []);
      }
      const saved = await schedules.revise(actor, id, version, data); review(formatSchedule(saved)); return { candidateId: saved.id, version: saved.version, preview: formatSchedule(saved) };
    } }),
    confirm_schedule: tool({ description: "Confirm the exact current schedule preview after an explicit yes. Backend requires the latest sent reply to be that preview. Missing dates/time zone or unclear cells prevent confirmation.", inputSchema: z.object({ id: z.uuid(), version: z.number().int().positive() }), execute: ({ id, version }) => schedules.confirm(actor, id, version) }),
    get_availability: tool({ description: "Refresh selected Google calendars and combine confirmed schedules for explicit dates/time zone (at most 90 days). Busy commitments override declared free time. Unknown/failed calendar data must never be presented as free. Class commitments remain hard constraints; this tool never removes a class or books travel.", inputSchema: z.object({ startDate: z.iso.date(), endDate: z.iso.date(), timeZone: zoneSchema }), execute: async ({ startDate, endDate, timeZone }) => {
      const range = planningRange(startDate, endDate, timeZone);
      const [rows, synced] = await Promise.all([schedules.state(actor.userId), calendar.sync(actor.userId, range)]);
      let unknown = synced.unknown || rows.some((row) => row.status === "candidate"), windows = [...synced.windows];
      for (const row of rows.filter((row) => row.status === "confirmed")) {
        try { windows.push(...expandSchedule(row.data, range, `schedule:${row.id}`)); } catch { unknown = true; }
      }
      const slots = availability(range, windows, synced.healthy, unknown);
      return { timeZone, refreshedAt: synced.refreshedAt, calendarHealthy: synced.healthy, unknownSource: unknown,
        busy: windows.filter((window) => window.kind === "busy" || window.kind === "class").slice(0, 100), slots: slots.slice(0, 100), truncated: slots.length > 100,
        explanation: "no_calendar_conflict means only that checked calendars contain no conflict, not guaranteed availability. Explicit user availability is separate; blank screenshots never prove free time." };
    } }),
    propose_calendar_test: tool({ description: "Present a real 10-minute [DEMO] Calendar test, five minutes from now, in exactly one selected owned calendar. No write occurs until a separate explicit approval after the exact review is sent.", inputSchema: z.object({}), execute: async () => { const text = await calendar.proposeTest(actor); review(text); return { review: text }; } }),
    approve_calendar_test: tool({ description: "Approve only the exact presented [DEMO] Calendar integration test after the user's explicit yes. Backend checks ownership, sent review and selection version, deduplicates the write and reads it back. No flights or rides are booked.", inputSchema: z.object({ id: z.uuid() }), execute: ({ id }) => calendar.approveTest(actor, id) }),
    review_calendar_test: tool({ description: "Show an existing calendar test's exact review to reconcile an unknown result or retry the same action. Do this before requesting another approval; never create a new action merely to retry an uncertain one.", inputSchema: z.object({ id: z.uuid() }), execute: async ({ id }) => { const text = await calendar.reviewTest(actor.userId, id); review(text); return { review: text }; } }),
  };
}
export async function scheduleCommand(services: ScheduleServices, actor: Actor): Promise<string | null> {
  const text = actor.sourceText.trim();
  if (text === "/connect-calendar") return `connect Google Calendar here\n${await services.calendar.link(actor)}\nthen come back and say done`;
  if (text === "/calendars") {
    const choices = await services.calendar.calendars(actor.userId);
    return formatCalendarChoices(choices);
  }
  if (text.startsWith("/use-calendar ")) {
    const references = text.slice(14).split(",").map((value) => value.trim());
    return `all set! i'll use ${(await services.calendar.select(actor, references)).selected.join(", ")} to check your schedule`;
  }
  if (text === "/disconnect-calendar") { await services.calendar.disconnect(actor); return "Google Calendar disconnected. I won't treat missing calendar data as free time."; }
  if (text === "/calendar-test") return services.calendar.proposeTest(actor);
  if (text.startsWith("/approve-calendar ")) return services.calendar.approveTest(actor, text.slice(18).trim());
  if (text.startsWith("/calendar-review ")) return services.calendar.reviewTest(actor.userId, text.slice(17).trim());
  if (text === "/schedule") {
    const rows = await services.schedules.state(actor.userId);
    const pending = rows.find((row) => row.status === "candidate");
    return pending ? formatSchedule(pending) : rows.length ? rows.map((row: SavedSchedule) => formatSchedule(row)).join("\n\n") : "no schedule saved yet. text your commitments/availability with dates and time zone, or send a legible schedule screenshot.";
  }
  return (await services.calendar.conversation?.(actor)) ?? null;
}
