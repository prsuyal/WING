import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";

export const zoneSchema = z.string().refine((zone) => {
  if (zone !== "UTC" && !zone.includes("/")) return false;
  try { Temporal.Now.zonedDateTimeISO(zone); return true; } catch { return false; }
}, "A confirmed IANA time zone is required");
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const scheduleSchema = z.object({
  timeZone: zoneSchema.nullable(), startDate: z.iso.date().nullable(), endDate: z.iso.date().nullable(),
  rules: z.array(z.object({
    label: z.string().trim().min(1).max(120), kind: z.enum(["class", "busy", "available", "context"]),
    date: z.iso.date().nullable(), weekdays: z.array(z.number().int().min(1).max(7)).max(7),
    startTime: clock.nullable(), endTime: clock.nullable(), spanDays: z.number().int().min(0).max(7), allDay: z.boolean(),
    excludedDates: z.array(z.iso.date()).max(50), uncertain: z.boolean().describe("True only for an unreadable or ambiguous block, not because a candidate awaits confirmation"),
  }).strict()).min(1).max(24),
  notes: z.array(z.string().max(200)).max(20).describe("Only unresolved illegible or ambiguous details. Do not include routine confirmation requests or blank-space disclaimers"),
}).strict();
export type Schedule = z.infer<typeof scheduleSchema>;
export type Window = { start: string; end: string; timeZone: string; kind: "class" | "busy" | "available" | "context"; label: string; source: string };
export const visibleDaysSchema = z.array(z.object({ weekday: z.number().int().min(1).max(7), day: z.number().int().min(1).max(31) }).strict()).max(7);
export const scheduleLabel = (label: string) => label.split(/\s[-–—]\s/)[0]!.trim();
function sameLabel(a: string, b: string) {
  const key = (text: string) => scheduleLabel(text).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const left = key(a), right = key(b);
  return left === right || (Math.min(left.length, right.length) >= 16 && (left.startsWith(right + " ") || right.startsWith(left + " ")));
}
export function reconcileSchedule(input: Schedule, windows: Window[], visibleDays: z.infer<typeof visibleDaysSchema> = []): Schedule {
  const data = structuredClone(input);
  if (!data.timeZone) return data;
  const zone = data.timeZone;
  const events = windows.map((window) => ({ ...window, a: Temporal.Instant.from(window.start).toZonedDateTimeISO(zone), b: Temporal.Instant.from(window.end).toZonedDateTimeISO(zone) }));
  const time = (value: Temporal.ZonedDateTime) => value.toPlainTime().toString({ smallestUnit: "minute" });
  const fits = (rule: Schedule["rules"][number], event: typeof events[number]) => sameLabel(rule.label, event.label) && (rule.date ? rule.date === event.a.toPlainDate().toString() : rule.weekdays.includes(event.a.dayOfWeek)) && (rule.allDay || ((!rule.startTime || rule.startTime === time(event.a)) && (!rule.endTime || rule.endTime === time(event.b))));
  // A cropped week gets dates only from two distinct matching commitments, never today's date alone.
  if ((!data.startDate || !data.endDate) && visibleDays.length === 7) {
    const weeks = new Map<string, Set<string>>();
    for (const rule of data.rules) for (const event of events.filter((event) => fits(rule, event))) {
      const index = visibleDays.findIndex((day) => day.weekday === event.a.dayOfWeek && day.day === event.a.day);
      if (index < 0) continue;
      const start = event.a.toPlainDate().subtract({ days: index });
      if (!visibleDays.every((day, i) => { const date = start.add({ days: i }); return date.dayOfWeek === day.weekday && date.day === day.day; })) continue;
      const key = start.toString(), labels = weeks.get(key) ?? new Set<string>(); labels.add(scheduleLabel(rule.label).toLowerCase()); weeks.set(key, labels);
    }
    const matches = [...weeks].filter(([, labels]) => labels.size >= 2);
    if (matches.length === 1) { data.startDate = matches[0]![0]; data.endDate = Temporal.PlainDate.from(data.startDate).add({ days: 6 }).toString(); }
  }
  if (!data.startDate || !data.endDate) return data;
  const start = Temporal.PlainDate.from(data.startDate), end = Temporal.PlainDate.from(data.endDate);
  const oneWeek = start.until(end).days >= 0 && start.until(end).days <= 6;
  if (oneWeek) data.rules = data.rules.flatMap((rule) => {
    if (rule.date) return [rule];
    const dates: string[] = [];
    for (let day = start; Temporal.PlainDate.compare(day, end) <= 0; day = day.add({ days: 1 })) if (rule.weekdays.includes(day.dayOfWeek)) dates.push(day.toString());
    return dates.map((date) => ({ ...rule, date, weekdays: [] }));
  });
  const resolvedLabels: string[] = [];
  for (const rule of data.rules) {
    const matches = events.filter((event) => fits(rule, event) && event.a.toPlainDate().toString() >= data.startDate! && event.a.toPlainDate().toString() <= data.endDate!);
    if (matches.length !== 1) continue;
    const event = matches[0]!, span = event.a.toPlainDate().until(event.b.toPlainDate()).days;
    if (span < 0 || span > 7) continue;
    resolvedLabels.push(scheduleLabel(rule.label).toLowerCase());
    rule.label = event.label;
    rule.startTime = rule.allDay ? null : time(event.a); rule.endTime = rule.allDay ? null : time(event.b);
    rule.spanDays = span; rule.uncertain = false;
  }
  // Keep unresolved notes; discard only notes tied to details that are now complete.
  data.notes = data.notes.filter((note) => {
    if (/conflict|different|overlap|contradict/i.test(note)) return true;
    if (/\b(month|year|semester|dates|time zone)\b.*\b(missing|not visible|unknown|not shown|unconfirmed)\b/i.test(note) && !/\b(interview|conflict|different|overlap)\b/i.test(note)) return false;
    if (!/unreadable|illegible|truncated|cannot be read|unclear|no visible time/i.test(note) || /conflict|different|overlap|contradict/i.test(note)) return true;
    const words = new Set(note.toLowerCase().match(/\p{L}+/gu));
    const mentions = (label: string) => (label.match(/\p{L}+/gu) ?? []).some((word) => word.length >= 4 && !["with", "from", "this", "that"].includes(word) && words.has(word));
    const related = data.rules.filter((rule) => mentions(rule.label.toLowerCase()));
    return !(resolvedLabels.some(mentions) && related.length && related.every((rule) => !rule.uncertain && (rule.allDay || (rule.startTime && rule.endTime))));
  });
  return scheduleSchema.parse(data);
}
export function localInstant(date: string, time: string, zone: string) {
  zoneSchema.parse(zone);
  return Temporal.PlainDate.from(date).toPlainDateTime(Temporal.PlainTime.from(time)).toZonedDateTime(zone, { disambiguation: "reject" }).toInstant().toString();
}
export function planningRange(startDate: string, endDate: string, zone: string) {
  const start = Temporal.PlainDate.from(z.iso.date().parse(startDate));
  const last = Temporal.PlainDate.from(z.iso.date().parse(endDate));
  const days = start.until(last).days;
  if (days < 0 || days > 89) throw new Error("Choose a planning horizon of at most 90 days");
  return { start: localInstant(start.toString(), "00:00", zone), end: localInstant(last.add({ days: 1 }).toString(), "00:00", zone) };
}
export function validateConfirmedSchedule(input: unknown) {
  const data = scheduleSchema.parse(input);
  if (!data.timeZone || !data.startDate || !data.endDate || data.notes.length) throw new Error("Confirm dates, time zone and unclear details first");
  const start = Temporal.PlainDate.from(data.startDate), end = Temporal.PlainDate.from(data.endDate);
  if (start.until(end).days < 0 || start.until(end).days > 370) throw new Error("Choose an explicit schedule period of at most one year");
  for (const rule of data.rules) {
    if (rule.uncertain || (!rule.date && !rule.weekdays.length) || (!rule.allDay && (!rule.startTime || !rule.endTime))) throw new Error("Clarify illegible or incomplete schedule blocks before confirming");
    if (rule.date && (rule.date < data.startDate || rule.date > data.endDate)) throw new Error("A one-off block must be within the confirmed schedule dates");
    if (!rule.allDay && rule.spanDays === 0 && rule.endTime! <= rule.startTime!) throw new Error("End time must follow start time; specify overnight days explicitly");
  }
  return data as Schedule & { timeZone: string; startDate: string; endDate: string };
}
export function expandSchedule(input: unknown, range: { start: string; end: string }, source: string): Window[] {
  const data = validateConfirmedSchedule(input);
  const queryStart = Temporal.Instant.from(range.start).toZonedDateTimeISO(data.timeZone).toPlainDate().subtract({ days: 7 });
  const queryEnd = Temporal.Instant.from(range.end).toZonedDateTimeISO(data.timeZone).toPlainDate();
  let date = Temporal.PlainDate.compare(queryStart, data.startDate) < 0 ? Temporal.PlainDate.from(data.startDate) : queryStart;
  const windows: Window[] = [];
  while (Temporal.PlainDate.compare(date, queryEnd) <= 0 && date.toString() <= data.endDate) {
    const day = date.toString();
    for (const rule of data.rules) {
      if ((rule.date ? rule.date !== day : !rule.weekdays.includes(date.dayOfWeek)) || rule.excludedDates.includes(day)) continue;
      const start = localInstant(day, rule.allDay ? "00:00" : rule.startTime!, data.timeZone);
      const end = localInstant(date.add({ days: rule.allDay ? Math.max(1, rule.spanDays) : rule.spanDays }).toString(), rule.allDay ? "00:00" : rule.endTime!, data.timeZone);
      if (Temporal.Instant.compare(start, range.end) < 0 && Temporal.Instant.compare(end, range.start) > 0) windows.push({ start, end, timeZone: data.timeZone, kind: rule.kind, label: rule.label, source });
      if (windows.length > 3000) throw new Error("Too many schedule blocks for this horizon");
    }
    date = date.add({ days: 1 });
  }
  return windows;
}
const googleEventSchema = z.object({
  id: z.string(), status: z.string().optional(), summary: z.string().optional(), transparency: z.string().optional(),
  start: z.object({ date: z.iso.date().optional(), dateTime: z.string().optional(), timeZone: z.string().optional() }).optional(),
  end: z.object({ date: z.iso.date().optional(), dateTime: z.string().optional(), timeZone: z.string().optional() }).optional(),
  attendees: z.array(z.object({ self: z.boolean().optional(), responseStatus: z.string().optional() })).optional(),
});
export function normalizeGoogleEvents(events: unknown[], calendarZone: string, calendarId: string): Window[] {
  return events.flatMap((input) => {
    const event = googleEventSchema.parse(input);
    if (event.status === "cancelled" || event.transparency === "transparent" || event.attendees?.some((person) => person.self && person.responseStatus === "declined")) return [];
    if (!event.start || !event.end) throw new Error("Incomplete calendar event; availability is unknown");
    const zone = zoneSchema.parse(event.start.timeZone || calendarZone);
    function instant(value: { date?: string; dateTime?: string }) {
      if (value.date) return localInstant(value.date, "00:00", zone);
      if (!value.dateTime) throw new Error("Calendar time missing");
      if (/(Z|[+-]\d\d:\d\d)$/.test(value.dateTime)) return Temporal.Instant.from(value.dateTime).toString();
      return Temporal.PlainDateTime.from(value.dateTime).toZonedDateTime(zone, { disambiguation: "reject" }).toInstant().toString();
    }
    const start = instant(event.start), end = instant(event.end);
    if (Temporal.Instant.compare(end, start) <= 0) throw new Error("Invalid calendar event range");
    return [{ start, end, timeZone: zone, kind: "busy" as const, label: (event.summary || "calendar commitment").slice(0, 120), source: `google:${calendarId}:${event.id}` }];
  });
}
export function availability(range: { start: string; end: string }, windows: Window[], calendarHealthy: boolean, unknownSource: boolean) {
  const lower = Temporal.Instant.from(range.start).epochMilliseconds, upper = Temporal.Instant.from(range.end).epochMilliseconds;
  const intervals = windows.map((window) => ({ ...window, a: Math.max(lower, Temporal.Instant.from(window.start).epochMilliseconds), b: Math.min(upper, Temporal.Instant.from(window.end).epochMilliseconds) })).filter((window) => window.b > window.a);
  const edges = [...new Set([lower, upper, ...intervals.flatMap((window) => [window.a, window.b])])].sort((a, b) => a - b);
  const slots: { start: string; end: string; status: string; conflicts: string[]; contradiction: boolean }[] = [];
  for (let index = 0; index < edges.length - 1; index++) {
    const a = edges[index]!, b = edges[index + 1]!;
    const covering = intervals.filter((window) => window.a < b && window.b > a);
    const busy = covering.filter((window) => window.kind === "busy" || window.kind === "class"), declared = covering.some((window) => window.kind === "available");
    const status = busy.length ? "busy" : unknownSource ? "unknown" : declared ? "declared_available" : calendarHealthy ? "no_calendar_conflict" : "unknown";
    slots.push({ start: Temporal.Instant.fromEpochMilliseconds(a).toString(), end: Temporal.Instant.fromEpochMilliseconds(b).toString(), status, conflicts: [...new Set(busy.map((window) => window.label))], contradiction: busy.length > 0 && declared });
  }
  return slots;
}
