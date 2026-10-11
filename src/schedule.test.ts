import assert from "node:assert/strict";
import { test } from "node:test";
import { Temporal } from "@js-temporal/polyfill";
import { localInstant, planningRange, expandSchedule, validateConfirmedSchedule, normalizeGoogleEvents, availability, reconcileSchedule, type Schedule, type Window } from "./schedule.ts";
import { credentialVault } from "./credentials.ts";
import { affirmative, formatSchedule } from "./schedule-store.ts";

const schedule: Schedule = { timeZone: "America/New_York", startDate: "2026-10-26", endDate: "2026-11-09", notes: [], rules: [{ label: "Math class", kind: "class", date: null, weekdays: [1], startTime: "09:00", endTime: "10:00", spanDays: 0, allDay: false, excludedDates: [], uncertain: false }] };

test("weekly classes keep local times across daylight-saving changes and honor exceptions", () => {
  const range = planningRange("2026-10-26", "2026-11-09", "America/New_York");
  const windows = expandSchedule(schedule, range, "schedule:test");
  assert.deepEqual(windows.map((window) => window.start), ["2026-10-26T13:00:00Z", "2026-11-02T14:00:00Z", "2026-11-09T14:00:00Z"]);
  const exception = { ...schedule, rules: [{ ...schedule.rules[0]!, excludedDates: ["2026-11-02"] }] };
  assert.equal(expandSchedule(exception, range, "schedule:test").length, 2);
});
test("ambiguous and nonexistent daylight-saving times require clarification", () => {
  assert.throws(() => localInstant("2026-11-01", "01:30", "America/New_York"));
  assert.throws(() => localInstant("2026-03-08", "02:30", "America/New_York"));
  assert.throws(() => localInstant("2026-10-26", "09:00", "EST"));
});
test("all-day Google events use calendar-local exclusive dates, including a 25-hour day", () => {
  const events = normalizeGoogleEvents([{ id: "day", start: { date: "2026-11-01" }, end: { date: "2026-11-02" } }], "America/New_York", "calendar");
  assert.equal(events[0]!.start, "2026-11-01T04:00:00Z");
  assert.equal(events[0]!.end, "2026-11-02T05:00:00Z");
});
test("cancelled recurrence instances, free events and self-declined invitations do not block time", () => {
  assert.deepEqual(normalizeGoogleEvents([{ id: "cancelled", status: "cancelled" }, { id: "free", transparency: "transparent" }, { id: "declined", attendees: [{ self: true, responseStatus: "declined" }] }], "America/New_York", "calendar"), []);
  assert.throws(() => normalizeGoogleEvents([{ id: "incomplete" }], "America/New_York", "calendar"));
});
test("calendar timestamps normalize offsets and missing offsets use the event's IANA zone", () => {
  const event = { id: "lecture", start: { dateTime: "2026-10-26T09:00:00", timeZone: "America/New_York" }, end: { dateTime: "2026-10-26T10:00:00-04:00" } };
  const [window] = normalizeGoogleEvents([event], "Europe/London", "calendar");
  assert.equal(window!.start, "2026-10-26T13:00:00Z"); assert.equal(window!.end, "2026-10-26T14:00:00Z");
});
test("unknown calendar data is never free and busy commitments beat declared availability", () => {
  const range = { start: "2026-10-26T12:00:00Z", end: "2026-10-26T15:00:00Z" };
  const busy = expandSchedule(schedule, range, "schedule:test");
  assert.equal(availability(range, [], false, false)[0]!.status, "unknown");
  const free = { start: range.start, end: range.end, kind: "available" as const, label: "user said free", timeZone: "America/New_York", source: "text" };
  assert.ok(availability(range, [free], false, true).every((slot) => slot.status === "unknown"));
  const slots = availability(range, [free, ...busy], true, false);
  assert.deepEqual(slots.map((slot) => slot.status), ["declared_available", "busy", "declared_available"]);
  assert.equal(slots[1]!.contradiction, true);
});
test("half-open boundaries avoid conflicts when a flight journey starts as a class ends", () => {
  const range = { start: "2026-10-26T14:00:00Z", end: "2026-10-26T15:00:00Z" };
  assert.equal(expandSchedule(schedule, range, "schedule:test").length, 0);
  assert.equal(availability(range, [], true, false)[0]!.status, "no_calendar_conflict");
});
test("candidate confirmation rejects missing semester, time zone, unreadable cells and invalid bounds", () => {
  for (const candidate of [{ ...schedule, timeZone: null }, { ...schedule, startDate: null }, { ...schedule, notes: ["unreadable classroom time"] }, { ...schedule, rules: [{ ...schedule.rules[0]!, uncertain: true }] }, { ...schedule, rules: [{ ...schedule.rules[0]!, endTime: "08:00" }] }, { ...schedule, endDate: "2026-10-01" }]) assert.throws(() => validateConfirmedSchedule(candidate));
  assert.throws(() => planningRange("2026-10-01", "2027-02-01", "America/New_York"));
});
test("explicit multi-day availability expands without assuming blank days are free", () => {
  const data: Schedule = { ...schedule, rules: [{ ...schedule.rules[0]!, date: "2026-10-30", weekdays: [], kind: "available", startTime: "17:00", endTime: "08:00", spanDays: 3 }] };
  const range = planningRange("2026-10-30", "2026-11-02", "America/New_York");
  const [window] = expandSchedule(data, range, "schedule:test");
  assert.equal(Temporal.Instant.from(window!.start).toZonedDateTimeISO("America/New_York").hour, 17);
  assert.equal(window!.end, "2026-11-02T13:00:00Z");
});
test("credential encryption is random, authenticated and bound to the exact owner", () => {
  const vault = credentialVault("01".repeat(32)), secret = { access: "synthetic-access", refresh: "synthetic-refresh" };
  const encrypted = vault.seal("owner", secret);
  assert.notEqual(encrypted, vault.seal("owner", secret));
  assert.deepEqual(vault.open("owner", encrypted), secret);
  assert.throws(() => vault.open("other", encrypted));
  const tampered = Buffer.from(encrypted, "base64"); tampered[tampered.length - 1]! ^= 1;
  assert.throws(() => vault.open("owner", tampered.toString("base64")));
  assert.throws(() => credentialVault("short"));
});
test("affirmation excludes uncertain or contradictory answers", () => {
  for (const text of ["yes", "yes, save this schedule", "I confirm", "looks good!", "ya", "yup", "👍🏽"]) assert.equal(affirmative(text), true);
  for (const text of ["maybe", "yes but the dates are wrong", "do not confirm", "no", "yes except Monday", "ya?", "yup if the time changes"]) assert.equal(affirmative(text), false);
});

const week: Schedule = { timeZone: "America/New_York", startDate: null, endDate: null, notes: ["Month and year are not visible.", "Interview with Taylor & label is truncated and its time cannot be read."], rules: [
  { ...schedule.rules[0]!, label: "Database Systems - Room 14", weekdays: [1, 3], startTime: "11:15", endTime: "12:30" },
  { ...schedule.rules[0]!, label: "Office Hours", kind: "busy", weekdays: [1], startTime: "09:00", endTime: "11:00" },
  { ...schedule.rules[0]!, label: "Interview with Taylor &", kind: "busy", weekdays: [2], startTime: null, endTime: null, uncertain: true },
  { ...schedule.rules[0]!, label: "Fall Break", kind: "context", weekdays: [4], allDay: true, startTime: null, endTime: null, spanDays: 2 },
] };
const headers = [7, 1, 2, 3, 4, 5, 6].map((weekday, i) => ({ weekday, day: 11 + i }));
const event = (label: string, date: string, start: string, end: string): Window => ({ label, start: localInstant(date, start, "America/New_York"), end: localInstant(date, end, "America/New_York"), timeZone: "America/New_York", kind: "busy", source: "google:owned:test" });
const matches = [event("Database Systems", "2026-10-12", "11:15", "12:30"), event("Office Hours", "2026-10-12", "09:00", "11:00"), event("Interview with Taylor & Alex", "2026-10-13", "15:00", "15:15")];

test("cropped week dates and unreadable times resolve from unique matching calendar context", () => {
  const result = reconcileSchedule(week, matches, headers);
  assert.equal(result.startDate, "2026-10-11"); assert.equal(result.endDate, "2026-10-17");
  assert.ok(result.rules.every((rule) => rule.date && !rule.weekdays.length));
  const interview = result.rules.find((rule) => rule.label.startsWith("Interview"))!;
  assert.equal(interview.startTime, "15:00"); assert.equal(interview.endTime, "15:15"); assert.equal(interview.uncertain, false);
  assert.deepEqual(result.notes, []); validateConfirmedSchedule(result);
  assert.equal(result.rules.find((rule) => rule.label.startsWith("Interview"))!.label, "Interview with Taylor & Alex");
  assert.deepEqual(reconcileSchedule({ ...week, notes: ["Tuesday interview block is truncated and has no visible time; its full title and attendees are unreadable."] }, matches, headers).notes, []);
  const followingWeek = planningRange("2026-10-18", "2026-10-24", "America/New_York");
  assert.deepEqual(expandSchedule(result, followingWeek, "screenshot"), []);
});
test("missing or contradictory date headers never acquire an invented month or year", () => {
  assert.equal(reconcileSchedule(week, matches, []).startDate, null);
  assert.equal(reconcileSchedule(week, [matches[0]!], headers).startDate, null);
  assert.equal(reconcileSchedule(week, matches, headers.map((header) => ({ ...header, day: header.day + 1 }))).startDate, null);
  assert.equal(reconcileSchedule({ ...week, timeZone: null }, matches, headers).timeZone, null);
});
test("ambiguous and partially missing times require a targeted clarification", () => {
  const partial = { ...week, rules: week.rules.map((rule) => rule.label.startsWith("Interview") ? { ...rule, startTime: "15:00" } : rule) };
  assert.equal(reconcileSchedule(partial, matches, headers).rules.find((rule) => rule.label.startsWith("Interview"))!.endTime, "15:15");
  const conflicting = { ...week, rules: week.rules.map((rule) => rule.label.startsWith("Interview") ? { ...rule, startTime: "17:00" } : rule) };
  assert.equal(reconcileSchedule(conflicting, matches, headers).rules.find((rule) => rule.label.startsWith("Interview"))!.endTime, null);
  const ambiguous = reconcileSchedule(week, [...matches, event("Interview with Taylor & Morgan", "2026-10-13", "17:00", "17:15")], headers);
  assert.equal(ambiguous.rules.find((rule) => rule.label.startsWith("Interview"))!.uncertain, true);
  assert.throws(() => validateConfirmedSchedule(ambiguous));
  const preview = formatSchedule({ id: "test", version: 1, status: "candidate", origin: "screenshot", last_edit_message_id: "source", data: ambiguous });
  assert.match(preview, /one thing I couldn't read: Interview with Taylor/);
  assert.doesNotMatch(preview, /notes:|date unknown|\(busy\)|America\/New_York/);
});
test("a two-day holiday marker preserves its span without claiming the user is free", () => {
  const result = reconcileSchedule(week, matches, headers);
  const range = planningRange("2026-10-15", "2026-10-16", "America/New_York");
  const windows = expandSchedule(result, range, "screenshot");
  assert.equal(windows.length, 1); assert.equal(windows[0]!.end, "2026-10-17T04:00:00Z");
  assert.equal(availability(range, windows, false, false)[0]!.status, "unknown");
  assert.equal(availability(range, windows, true, false)[0]!.status, "no_calendar_conflict");
  const preview = formatSchedule({ id: "test", version: 1, status: "candidate", origin: "screenshot", last_edit_message_id: "source", data: result });
  assert.match(preview, /Thu–Fri: Fall Break/); assert.match(preview, /9–11am/); assert.match(preview, /11:15am–12:30pm/); assert.match(preview, /look right\? reply yes/);
});
test("an explicit semester remains recurring and keeps unresolved contradictions", () => {
  const result = reconcileSchedule({ ...schedule, notes: ["The year conflicts with the calendar."] }, [], headers);
  assert.equal(result.rules[0]!.date, null); assert.deepEqual(result.rules[0]!.weekdays, [1]);
  assert.deepEqual(result.notes, ["The year conflicts with the calendar."]);
});
