import type { SupabaseClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import { isYes, understands, type Actor } from "./contracts.ts";
import { credentialVault, newToken, tokenHash } from "./credentials.ts";
import { normalizeGoogleEvents, zoneSchema, type Window } from "./schedule.ts";
import { affirmative } from "./schedule-store.ts";
import { itineraryEventSchema, type ItineraryEvent } from "./journey.ts";

const scopes = ["calendar.calendarlist.readonly", "calendar.events.readonly", "calendar.events.owned"].map((scope) => `https://www.googleapis.com/auth/${scope}`);
const credentialsSchema = z.object({ access: z.string().min(1), refresh: z.string().min(1), expiry: z.number(), scopes: z.array(z.string()) });
const choiceSchema = z.object({ id: z.string(), summary: z.string(), timeZone: z.string().nullable(), accessRole: z.string(), primary: z.boolean() });
type Choice = z.infer<typeof choiceSchema>;
export function formatCalendarChoices(choices: Choice[]) {
  return choices.length ? `${choices.length > 1 ? "i found multiple calendars in your google account. which should i use?" : "i found your calendar. should i use this one?"}\n\n${choices.map((choice, index) => `${index + 1}. ${choice.summary}${choice.primary ? " (primary)" : ""}`).join("\n")}\n\nreply with a number or name, like 7 or primary\nyou can also pick more than one: 1, 7` : "no calendars found, let's reconnect google calendar";
}
export function matchesCalendarChoices(text: string, choices: Choice[]) {
  const legacy = choices.map((choice, index) => `${index + 1}. ${choice.summary}${choice.primary ? " (primary)" : ""} — ${choice.accessRole}`).join("\n");
  const previous = `which calendars should i use?\n${choices.map((choice, index) => `${index + 1}. ${choice.summary}${choice.primary ? " (primary)" : ""}`).join("\n")}\nreply with a number or name — you can pick more than one, like 1, 7`;
  return !!choices.length && (text === formatCalendarChoices(choices) || text === previous || text === `${legacy}\ntext /use-calendar 1 (or numbers separated by commas) to choose.`);
}
export function calendarReferences(text: string, choices: Choice[]) {
  const value = text.trim().replace(/[!.]+$/, "").replace(/^(?:(?:use|choose|select)(?: calendars?)?|calendars?|let['’]?s do|go with)\s+/i, "").replace(/\s+please$/i, "").trim();
  if (/^\d+(?:\s*(?:,|and|&)\s*\d+)*$/i.test(value)) return value.split(/\s*(?:,|and|&)\s*/i);
  if (/^(?:my )?primary(?: calendar)?$/i.test(value)) return ["primary"];
  if (choices.some((choice) => choice.id === value || choice.summary.toLowerCase() === value.toLowerCase())) return [value];
  return null;
}
type Config = { baseUrl: string; clientId: string; clientSecret: string; encryptionKey: string; fetch?: typeof fetch };
class GoogleError extends Error { constructor(readonly status: number) { super("Google Calendar request failed; no private response logged"); } }
const html = (text: string) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
function page(response: ServerResponse, text: string, form = "", status = 200) {
  // Form POSTs need their same-origin Origin header; no-referrer makes it null in browsers.
  response.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://accounts.google.com; frame-ancestors 'none'; base-uri 'none'", "Referrer-Policy": "same-origin" });
  response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>wing · Google Calendar</title><style>body{font:18px/1.5 system-ui;max-width:34rem;margin:12vh auto;padding:24px;color:#123;background:#fffaf0}button{font:inherit;padding:12px 20px;border:0;border-radius:12px;background:#164981;color:white}h1{font-size:30px}</style><h1>wing</h1><p>${html(text)}</p>${form}</html>`);
}
export function createCalendar(client: SupabaseClient, config: Config) {
  const base = new URL(config.baseUrl);
  if ((base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname))) || base.pathname !== "/" || base.username || base.password) throw new Error("Use a trusted HTTPS PUBLIC_BASE_URL");
  const origin = base.origin, callback = `${origin}/auth/google/callback`;
  const vault = credentialVault(config.encryptionKey), send = config.fetch ?? fetch;
  const refreshing = new Map<string, Promise<string>>();
  async function connection(owner: string) {
    const { data, error } = await client.from("wing_calendar_connections").select("*").eq("owner_id", owner).maybeSingle();
    if (error) throw new Error("Calendar connection unavailable");
    return data;
  }
  async function lastReply(owner: string) {
    const { data, error } = await client.from("wing_messages").select("body,status").eq("owner_id", owner).eq("direction", "outbound").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error("Calendar choice context unavailable");
    return data?.status === "sent" ? String(data.body?.text ?? "") : "";
  }
  async function access(owner: string, force = false): Promise<string> {
    if (refreshing.has(owner)) return refreshing.get(owner)!;
    const current = await connection(owner);
    if (refreshing.has(owner)) return refreshing.get(owner)!;
    if (!current?.credentials_cipher || current.status === "disconnected") throw new Error("Connect Google Calendar first");
    const saved = credentialsSchema.parse(vault.open(owner, current.credentials_cipher));
    if (!force && saved.expiry > Date.now() + 30_000) return saved.access;
    const request = (async () => {
      const response = await send("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: saved.refresh, client_id: config.clientId, client_secret: config.clientSecret }), signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new GoogleError(response.status);
      const token = z.object({ access_token: z.string().min(1), expires_in: z.number().int().positive(), refresh_token: z.string().optional() }).parse(await response.json());
      const next = { ...saved, access: token.access_token, refresh: token.refresh_token || saved.refresh, expiry: Date.now() + token.expires_in * 1000 };
      const { error } = await client.from("wing_calendar_connections").update({ credentials_cipher: vault.seal(owner, next) }).eq("owner_id", owner).eq("credentials_cipher", current.credentials_cipher).neq("status", "disconnected").select("owner_id").single();
      if (error) throw new Error("Calendar connection changed during refresh");
      return next.access;
    })();
    refreshing.set(owner, request);
    try { return await request; } finally { refreshing.delete(owner); }
  }
  async function api(owner: string, path: string, init: RequestInit = {}) {
    let token = await access(owner);
    const request = () => send(`https://www.googleapis.com/calendar/v3/${path}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(15_000) });
    let response = await request();
    if (response.status === 401) { token = await access(owner, true); response = await request(); }
    if (!response.ok) throw new GoogleError(response.status);
    return response.json();
  }
  async function discover(owner: string): Promise<Choice[]> {
    const choices: Choice[] = []; let next = "";
    for (let page = 0; page < 10; page++) {
      const query = new URLSearchParams({ maxResults: "250" }); if (next) query.set("pageToken", next);
      const result = z.object({ items: z.array(z.object({ id: z.string(), summary: z.string().optional(), timeZone: z.string().optional(), accessRole: z.string(), primary: z.boolean().optional(), deleted: z.boolean().optional() })).default([]), nextPageToken: z.string().optional() }).parse(await api(owner, `users/me/calendarList?${query}`));
      choices.push(...result.items.filter((item) => !item.deleted && ["reader", "writer", "writerWithoutPrivateAccess", "owner"].includes(item.accessRole)).map((item) => ({ id: item.id, summary: item.summary || "untitled calendar", timeZone: item.timeZone ?? null, accessRole: item.accessRole, primary: !!item.primary })));
      next = result.nextPageToken || ""; if (!next) return choices;
    }
    throw new Error("Calendar list too large; do not use partial discovery");
  }
  async function matchingEvent(owner: string, action: Record<string, any>) {
    const event = z.object({ status: z.string().optional(), summary: z.string(), start: z.object({ dateTime: z.string() }), end: z.object({ dateTime: z.string() }), extendedProperties: z.object({ private: z.object({ wingAction: z.string() }) }) }).parse(await api(owner, `calendars/${encodeURIComponent(action.calendar_id)}/events/${action.event_id}`));
    if (event.status === "cancelled" || event.extendedProperties?.private?.wingAction !== action.id || event.summary !== action.event.summary || Temporal.Instant.compare(event.start?.dateTime, action.event.start.dateTime) !== 0 || Temporal.Instant.compare(event.end?.dateTime, action.event.end.dateTime) !== 0) throw new Error("Calendar event does not match the approved action");
    return event;
  }
  return {
    async writeTarget(owner: string) {
      const current = await connection(owner);
      if (!current?.credentials_cipher || current.status !== "connected") throw new Error("Connect Google Calendar first");
      const saved = credentialsSchema.parse(vault.open(owner, current.credentials_cipher));
      if (!saved.scopes.some((scope) => [scopes[2], "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar"].includes(scope))) throw new Error("Reconnect with event creation permission");
      const choices = (await discover(owner)).filter((choice) => current.selected_ids.includes(choice.id) && choice.accessRole === "owner");
      const target = choices.length === 1 ? choices[0] : choices.find((choice) => choice.primary);
      if (!target) throw new Error("Choose exactly one owned calendar for itinerary events");
      return { calendarId: target.id, calendarName: target.summary, selectionVersion: current.selection_version as number };
    },
    async ensureItineraryEvent(owner: string, calendarId: string, selectionVersion: number, candidate: ItineraryEvent) {
      const event = itineraryEventSchema.parse(candidate), target = await this.writeTarget(owner);
      if (target.calendarId !== calendarId || target.selectionVersion !== selectionVersion) throw new Error("Calendar selection changed");
      const path = `calendars/${encodeURIComponent(calendarId)}/events`;
      const matches = (saved: any) => {
        if (saved.status === "cancelled" || saved.summary !== event.summary || saved.description !== event.description || saved.location !== event.location || saved.visibility !== event.visibility || saved.transparency !== event.transparency || saved.reminders?.useDefault !== false || JSON.stringify((saved.reminders?.overrides ?? []).map((item: any) => ({ method: item.method, minutes: item.minutes }))) !== JSON.stringify(event.reminders.overrides ?? []) || saved.attendees?.length || saved.recurrence?.length || Temporal.Instant.compare(saved.start.dateTime, event.start.dateTime) !== 0 || Temporal.Instant.compare(saved.end.dateTime, event.end.dateTime) !== 0 || saved.start.timeZone !== event.start.timeZone || saved.end.timeZone !== event.end.timeZone || Object.entries(event.extendedProperties.private).some(([key, value]) => saved.extendedProperties?.private?.[key] !== value)) throw new Error("Existing event differs from the approved itinerary; it was not changed");
      };
      try { matches(await api(owner, `${path}/${event.id}`)); return; }
      catch (error) { if (!(error instanceof GoogleError && error.status === 404)) throw error; }
      try { await api(owner, `${path}?sendUpdates=none`, { method: "POST", body: JSON.stringify(event) }); }
      catch (error) { if (!(error instanceof GoogleError && error.status === 409)) throw error; }
      matches(await api(owner, `${path}/${event.id}`));
    },
    async state(owner: string) {
      const current = await connection(owner);
      const { data: actions, error } = await client.from("wing_calendar_actions").select("id,status,review_text").eq("owner_id", owner).in("status", ["review", "processing", "unknown"]).order("created_at", { ascending: false }).limit(1);
      if (error) throw new Error("Calendar approval state unavailable");
      return { status: current?.status ?? "not_connected", selected: current?.selected_ids ?? [], choices: current?.choices ?? [], refreshedAt: current?.refreshed_at ?? null, pendingAction: actions?.[0] ?? null };
    },
    async link(actor: Actor) {
      const token = newToken();
      const { error } = await client.from("wing_calendar_links").insert({ owner_id: actor.userId, source_message_id: actor.sourceMessageId, token_hash: tokenHash(token), expires_at: new Date(Date.now() + 20 * 60_000).toISOString() });
      if (error) throw new Error("Private connection link unavailable");
      return `${origin}/auth/google/start?t=${token}`;
    },
    async calendars(owner: string) {
      const current = await connection(owner);
      const choices = await discover(owner);
      const { error } = await client.from("wing_calendar_connections").update({ choices }).eq("owner_id", owner).eq("selection_version", current?.selection_version).neq("status", "disconnected").select("owner_id").single();
      if (error) throw new Error("Calendar connection changed");
      return choices;
    },
    async select(actor: Actor, references: string[]) {
      z.array(z.string().min(1)).min(1).max(5).parse(references);
      let current = await connection(actor.userId);
      if (!current || current.status === "disconnected") throw new Error("Connect Google Calendar first");
      const legacy = actor.sourceText.trim().startsWith("/use-calendar ");
      if (!current.choices.length && legacy) { await this.calendars(actor.userId); current = await connection(actor.userId); }
      const choices = z.array(choiceSchema).parse(current!.choices);
      const stated = actor.interpret ? references : !legacy && choices.length === 1 && isYes(actor.sourceText) ? ["1"] : calendarReferences(legacy ? actor.sourceText.trim().slice(14) : actor.sourceText, choices);
      if (actor.interpret && !await actor.interpret(`Select these calendars for reading: ${JSON.stringify(references)} from this displayed list: ${formatCalendarChoices(choices)}. Numbers refer only to that delivered list, not a flight, date or budget`)) throw new Error("Choose a calendar by its displayed number or exact name");
      if (!stated) throw new Error("Choose a calendar by its displayed number or exact name");
      if (!legacy && (actor.interpret || stated.some((reference) => /^\d+$/.test(reference))) && !matchesCalendarChoices(await lastReply(actor.userId), choices)) throw new Error("Show a fresh calendar list before choosing a number");
      const resolve = (reference: string) => {
        const numeric = /^[1-9]\d*$/.test(reference) ? choices[Number(reference) - 1] : undefined;
        const matches = /^\d+$/.test(reference) ? (numeric ? [numeric] : []) : choices.filter((choice) => choice.id === reference || choice.summary.toLowerCase() === reference.toLowerCase() || (reference.toLowerCase() === "primary" && choice.primary));
        if (matches.length !== 1) throw new Error("Choose a calendar by its displayed number or exact name");
        return matches[0]!;
      };
      const requestedIds = new Set(stated.map((reference) => resolve(reference).id));
      const selected = references.map((reference) => {
        const choice = resolve(reference);
        if (!requestedIds.has(choice.id)) throw new Error("Calendar choice must match your reply");
        return choice;
      });
      if (new Set(selected.map((choice) => choice.id)).size !== requestedIds.size) throw new Error("Calendar choice must match your reply");
      const accessible = await discover(actor.userId);
      if (selected.some((choice) => !accessible.some((fresh) => fresh.id === choice.id))) throw new Error("Calendar list changed; show a fresh list");
      const { error } = await client.from("wing_calendar_connections").update({ status: "connected", selected_ids: [...new Set(selected.map((choice) => choice.id))], selection_version: current!.selection_version + 1, windows: [], range_start: null, range_end: null, refreshed_at: null }).eq("owner_id", actor.userId).eq("selection_version", current!.selection_version).neq("status", "disconnected").select("owner_id").single();
      if (error) throw new Error("Calendar selection changed; reload the list");
      return { selected: selected.map((choice) => choice.summary), writePermission: selected.some((choice) => choice.accessRole === "owner") ? "must be verified with an approved test" : "no owned calendar selected" };
    },
    async conversation(actor: Actor): Promise<string | null> {
      const text = actor.sourceText.trim();
      const list = /^(?:show|list)(?: me)?(?: my| the)? calendars?[!.\s]*$|^(?:my )?calendars?[!.\s]*$/i.test(text);
      const done = /^(?:done|all done|connected|i['’]m done|i connected (?:it|my calendar)|signed in|back|ready)[!.\s]*$/i.test(text);
      if (list) return formatCalendarChoices(await this.calendars(actor.userId));
      if (text.length > 200 || text.startsWith("/") || /^(hi|hello|hey|yo|sup)[!.\s]*$/i.test(text)) return null;
      const last = await lastReply(actor.userId);
      if (done && /come back and (?:say done|text \/calendars)/.test(last)) {
        const current = await connection(actor.userId);
        if (!current || current.status === "disconnected") return "finish Google sign-in using the link above, then say done";
        return formatCalendarChoices(await this.calendars(actor.userId));
      }
      if (!last.startsWith("i found multiple calendars") && !last.startsWith("i found your calendar") && !last.startsWith("which calendars should i use?\n") && !last.endsWith("text /use-calendar 1 (or numbers separated by commas) to choose.")) return null;
      const current = await connection(actor.userId);
      const choices = z.array(choiceSchema).parse(current?.choices ?? []);
      if (!matchesCalendarChoices(last, choices)) return formatCalendarChoices(await this.calendars(actor.userId));
      const references = choices.length === 1 && isYes(text) ? ["1"] : calendarReferences(text, choices);
      if (!references) return null;
      try { return `all set! i'll use ${(await this.select(actor, references)).selected.join(", ")} to check your schedule`; }
      catch (error) {
        if (error instanceof Error && /Choose a calendar|must match your reply/.test(error.message)) return `pick a number from 1–${choices.length}, or a calendar name`;
        if (error instanceof Error && /Show a fresh|Calendar list changed|Calendar selection changed/.test(error.message)) return formatCalendarChoices(await this.calendars(actor.userId));
        throw error;
      }
    },
    async sync(owner: string, range: { start: string; end: string }) {
      const current = await connection(owner);
      if (!current) return { healthy: false, unknown: false, windows: [] as Window[], refreshedAt: null };
      if (current.status === "disconnected" || !current.selected_ids.length) return { healthy: false, unknown: true, windows: [] as Window[], refreshedAt: null };
      try {
        const choices = await discover(owner), windows: Window[] = [];
        for (const id of current.selected_ids as string[]) {
          const choice = choices.find((item) => item.id === id); if (!choice) throw new Error("A selected calendar is no longer accessible");
          let next = "";
          for (let page = 0; page < 10; page++) {
            const query = new URLSearchParams({ singleEvents: "true", timeMin: range.start, timeMax: range.end, maxResults: "2500", orderBy: "startTime" }); if (next) query.set("pageToken", next);
            const result = z.object({ items: z.array(z.unknown()).default([]), timeZone: z.string().optional(), nextPageToken: z.string().optional() }).parse(await api(owner, `calendars/${encodeURIComponent(id)}/events?${query}`));
            windows.push(...normalizeGoogleEvents(result.items, choice.timeZone || result.timeZone || "", id));
            if (windows.length > 3000) throw new Error("Calendar horizon too large");
            next = result.nextPageToken || ""; if (!next) break;
          }
          if (next) throw new Error("Partial calendar results cannot establish availability");
        }
        const refreshedAt = new Date().toISOString();
        const { error } = await client.from("wing_calendar_connections").update({ status: "connected", choices, windows, range_start: range.start, range_end: range.end, refreshed_at: refreshedAt }).eq("owner_id", owner).eq("selection_version", current.selection_version).neq("status", "disconnected").select("owner_id").single();
        if (error) throw new Error("Calendar selection changed during sync");
        return { healthy: true, unknown: false, windows, refreshedAt };
      } catch {
        await client.from("wing_calendar_connections").update({ status: "error", range_start: null, range_end: null, refreshed_at: null }).eq("owner_id", owner).eq("selection_version", current.selection_version).neq("status", "disconnected");
        return { healthy: false, unknown: true, windows: [] as Window[], refreshedAt: null };
      }
    },
    async disconnect(actor: Actor) {
      if (!await understands(actor, "Disconnect Google Calendar from wing, without deleting events", /\b(disconnect|unlink|remove)\b/i.test(actor.sourceText))) throw new Error("Ask to disconnect the calendar explicitly");
      const current = await connection(actor.userId);
      const saved = current?.credentials_cipher ? credentialsSchema.parse(vault.open(actor.userId, current.credentials_cipher)) : null;
      const { error } = await client.from("wing_calendar_connections").update({ status: "disconnected", credentials_cipher: null, selected_ids: [], windows: [], range_start: null, range_end: null, refreshed_at: null, selection_version: (current?.selection_version ?? 0) + 1 }).eq("owner_id", actor.userId);
      if (error) throw new Error("Calendar disconnection failed");
      if (saved) { try { await send("https://oauth2.googleapis.com/revoke", { method: "POST", body: new URLSearchParams({ token: saved.refresh }), signal: AbortSignal.timeout(10_000) }); } catch { console.error("Google token revocation could not be confirmed; local credentials were removed."); } }
      return { disconnected: true, availability: "unknown until another schedule source is confirmed" };
    },
    async proposeTest(actor: Actor) {
      const current = await connection(actor.userId);
      if (!current || current.status !== "connected") throw new Error("Connect and select a Google calendar first");
      const choices = (current.choices as unknown[]).map((choice) => choiceSchema.parse(choice)).filter((choice) => current.selected_ids.includes(choice.id) && choice.accessRole === "owner");
      if (choices.length !== 1) throw new Error("Select exactly one owned calendar for the integration test");
      const saved = credentialsSchema.parse(vault.open(actor.userId, current.credentials_cipher));
      if (!saved.scopes.some((scope) => [scopes[2], "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar"].includes(scope))) throw new Error("Reconnect with event creation permission before this test");
      const choice = choices[0]!, zone = zoneSchema.parse(choice.timeZone), id = randomUUID();
      const start = Temporal.Instant.fromEpochMilliseconds(Math.ceil((Date.now() + 5 * 60_000) / 60_000) * 60_000), end = start.add({ minutes: 10 });
      const format = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
      const review = `add a real [DEMO] wing calendar test to ${choice.summary}?\n${format.format(start.epochMilliseconds)} – ${format.format(end.epochMilliseconds)}\n10 minutes; no reminders, attendees, flight or ride booking.\nreply yes, or /approve-calendar ${id.slice(0, 8)}, to approve.`;
      const eventId = `de${id.replaceAll("-", "")}`;
      const event = { id: eventId, summary: "[DEMO] wing calendar test", description: "Approved wing Calendar integration check. No flight, ride, or payment was booked.", transparency: "transparent", visibility: "private", start: { dateTime: start.toString(), timeZone: zone }, end: { dateTime: end.toString(), timeZone: zone }, reminders: { useDefault: false }, extendedProperties: { private: { wingAction: id } } };
      const { error } = await client.from("wing_calendar_actions").insert({ id, owner_id: actor.userId, source_message_id: actor.sourceMessageId, calendar_id: choice.id, selection_version: current.selection_version, event_id: eventId, event, review_text: review });
      if (error) throw new Error("Calendar test review could not be saved");
      return review;
    },
    async approveTest(actor: Actor, reference: string) {
      if (actor.replyInFlight || !await understands(actor, "Approve the exact calendar integration test in the last delivered review without conditions or changed terms", affirmative(actor.sourceText) || /^\/approve-calendar [0-9a-f-]{8,36}$/i.test(actor.sourceText.trim()))) throw new Error("Explicit calendar approval is required");
      z.string().regex(/^[0-9a-f-]{8,36}$/i).parse(reference);
      const { data: actions, error } = await client.from("wing_calendar_actions").select("*").eq("owner_id", actor.userId).order("created_at", { ascending: false }).limit(20);
      const matches = actions?.filter((action) => action.id.startsWith(reference)) ?? [];
      if (error || matches.length !== 1) throw new Error("Calendar action unavailable or ambiguous");
      const action = matches[0]!, current = await connection(actor.userId);
      if (!current || current.status !== "connected" || current.selection_version !== action.selection_version || !current.selected_ids.includes(action.calendar_id)) throw new Error("Calendar selection changed; request a fresh review");
      if (action.status === "confirmed") { await matchingEvent(actor.userId, action); return "that [DEMO] calendar test was already created. no duplicate was added."; }
      const { data: replies, error: replyError } = await client.from("wing_messages").select("body,status").eq("owner_id", actor.userId).eq("direction", "outbound").order("created_at", { ascending: false }).limit(1);
      if (replyError || replies?.[0]?.status !== "sent" || replies[0].body.text !== action.review_text || actor.sourceMessageId === action.source_message_id) throw new Error("Show the exact current calendar review before approving");
      if (action.status === "processing" && new Date(action.leased_until).getTime() > Date.now()) return "that calendar request is still processing. no duplicate request was sent.";
      const { error: lockError } = await client.from("wing_calendar_actions").update({ status: "processing", leased_until: new Date(Date.now() + 5 * 60_000).toISOString(), approval_message_id: actor.sourceMessageId }).eq("owner_id", actor.userId).eq("id", action.id).eq("status", action.status).select("id").single();
      if (lockError) return "that calendar request changed or is processing. no duplicate request was sent.";
      try {
        let exists = false;
        try { await matchingEvent(actor.userId, action); exists = true; } catch (error) { if (!(error instanceof GoogleError && error.status === 404)) throw error; }
        if (!exists) {
          if (Temporal.Instant.from(action.event.start.dateTime).epochMilliseconds <= Date.now()) throw new Error("The reviewed test time passed; request a new review");
          try { await api(actor.userId, `calendars/${encodeURIComponent(action.calendar_id)}/events?sendUpdates=none`, { method: "POST", body: JSON.stringify(action.event) }); }
          catch (error) { if (!(error instanceof GoogleError && error.status === 409)) throw error; }
          await matchingEvent(actor.userId, action);
        }
        const { error: saveError } = await client.from("wing_calendar_actions").update({ status: "confirmed", leased_until: null }).eq("owner_id", actor.userId).eq("id", action.id).eq("status", "processing").select("id").single();
        if (saveError) throw new Error("Calendar result needs reconciliation");
        return "added and read back your real [DEMO] wing calendar test. no flight, ride or payment was booked.";
      } catch {
        await client.from("wing_calendar_actions").update({ status: "unknown", leased_until: null }).eq("owner_id", actor.userId).eq("id", action.id).eq("status", "processing");
        return "i couldn't confirm the calendar result. it may have been created; don't create another test until we reconcile this one.";
      }
    },
    async reviewTest(owner: string, reference: string) {
      z.string().regex(/^[0-9a-f-]{8,36}$/i).parse(reference);
      const { data, error } = await client.from("wing_calendar_actions").select("id,review_text").eq("owner_id", owner).order("created_at", { ascending: false }).limit(20);
      const matching = data?.filter((action) => action.id.startsWith(reference)) ?? [];
      if (error || matching.length !== 1) throw new Error("Calendar review unavailable or ambiguous");
      return matching[0]!.review_text as string;
    },
    async http(request: IncomingMessage, response: ServerResponse) {
      const url = new URL(request.url || "/", origin);
      if (!["/auth/google/start", "/auth/google/callback"].includes(url.pathname)) return false;
      let stage = "link_format";
      try {
        if (url.pathname === "/auth/google/start") {
          const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(url.searchParams.get("t"));
          stage = "link_lookup";
          const { data: link, error } = await client.from("wing_calendar_links").select("*").eq("token_hash", tokenHash(token)).is("used_at", null).gt("expires_at", new Date().toISOString()).single();
          if (error || !link) throw new Error("Connection link unavailable");
          if (request.method === "GET") {
            const browser = newToken();
            response.setHeader("Set-Cookie", `wing_oauth=${browser}; HttpOnly; SameSite=Lax; Path=/auth/google; Max-Age=1200${base.protocol === "https:" ? "; Secure" : ""}`);
            page(response, "Connect Google Calendar to read selected calendars and, only after your approval in iMessage, create [DEMO] events. This private link expires in 20 minutes. Keep it private.", `<form method="post" action="/auth/google/start?t=${html(token)}"><button>Connect Google Calendar</button></form>`);
          } else if (request.method === "POST") {
            stage = "browser_origin";
            if (request.headers.origin !== origin) throw new Error("Invalid connection origin");
            stage = "browser_cookie";
            const browser = /(?:^|;\s*)wing_oauth=([A-Za-z0-9_-]{43})(?:;|$)/.exec(request.headers.cookie || "")?.[1]; if (!browser) throw new Error("Browser session missing");
            const state = newToken(), verifier = newToken(), challenge = createHash("sha256").update(verifier).digest("base64url");
            stage = "link_claim";
            const { error: useError } = await client.from("wing_calendar_links").update({ used_at: new Date().toISOString(), state_hash: tokenHash(state), browser_hash: tokenHash(browser), verifier_cipher: vault.seal(link.owner_id, verifier) }).eq("token_hash", link.token_hash).is("used_at", null).gt("expires_at", new Date().toISOString()).select("owner_id").single();
            if (useError) throw new Error("Connection link already used");
            const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
            auth.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: callback, response_type: "code", scope: scopes.join(" "), access_type: "offline", prompt: "consent select_account", include_granted_scopes: "true", state, code_challenge: challenge, code_challenge_method: "S256" }).toString();
            response.writeHead(303, { Location: auth.toString(), "Referrer-Policy": "no-referrer" }); response.end();
          } else { page(response, "Use the connection button to continue.", "", 405); }
        } else {
          stage = "callback_format";
          if (request.method !== "GET") throw new Error("Invalid callback method");
          const state = z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(url.searchParams.get("state"));
          stage = "callback_cookie";
          const browser = /(?:^|;\s*)wing_oauth=([A-Za-z0-9_-]{43})(?:;|$)/.exec(request.headers.cookie || "")?.[1]; if (!browser) throw new Error("Browser session missing");
          stage = "callback_lookup";
          const { data: link, error } = await client.from("wing_calendar_links").select("*").eq("state_hash", tokenHash(state)).eq("browser_hash", tokenHash(browser)).gt("expires_at", new Date().toISOString()).single();
          if (error || !link) throw new Error("Invalid or expired callback");
          stage = "callback_claim";
          const { error: consumeError } = await client.from("wing_calendar_links").update({ state_hash: null, browser_hash: null, verifier_cipher: null }).eq("token_hash", link.token_hash).eq("state_hash", tokenHash(state)).select("owner_id").single();
          if (consumeError) throw new Error("Callback already used");
          if (url.searchParams.has("error")) { page(response, "Google connection was cancelled. Return to wing in iMessage when you're ready to try again."); return true; }
          stage = "code_exchange";
          const code = z.string().min(1).max(4096).parse(url.searchParams.get("code"));
          const verifier = z.string().parse(vault.open(link.owner_id, link.verifier_cipher));
          const result = await send("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ code, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: callback, client_id: config.clientId, client_secret: config.clientSecret }), signal: AbortSignal.timeout(15_000) });
          if (!result.ok) throw new GoogleError(result.status);
          stage = "token_format";
          const token = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1), expires_in: z.number().int().positive(), scope: z.string() }).parse(await result.json());
          stage = "read_permission";
          const granted = token.scope.split(" ");
          if (!granted.includes(scopes[0]!) || !granted.some((scope) => [scopes[1], "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar"].includes(scope))) throw new Error("Calendar read permission missing");
          stage = "connection_save";
          const prior = await connection(link.owner_id);
          const { error: saveError } = await client.from("wing_calendar_connections").upsert({ owner_id: link.owner_id, credentials_cipher: vault.seal(link.owner_id, { access: token.access_token, refresh: token.refresh_token, expiry: Date.now() + token.expires_in * 1000, scopes: granted }), status: "connected", selected_ids: [], choices: [], windows: [], selection_version: (prior?.selection_version ?? 0) + 1, refreshed_at: null, range_start: null, range_end: null }, { onConflict: "owner_id" });
          if (saveError) throw new Error("Connection save failed");
          response.setHeader("Set-Cookie", `wing_oauth=; HttpOnly; SameSite=Lax; Path=/auth/google; Max-Age=0${base.protocol === "https:" ? "; Secure" : ""}`);
          page(response, "Google Calendar is connected! Return to wing and say done. You'll choose your calendars there. No event has been created.");
        }
      } catch (error) {
        console.error(JSON.stringify({ event: "calendar_connection_failed", stage, ...(error instanceof GoogleError ? { status: error.status } : {}) }));
        const detail = stage === "link_format" ? "The private link is missing or incomplete. Copy the entire link from iMessage into your browser."
          : stage === "link_lookup" ? "This private link has expired, was already used, or is unavailable."
          : ["browser_cookie", "callback_cookie"].includes(stage) ? "The browser session is missing. Open the new link and finish Google sign-in in the same browser with cookies enabled."
          : "The Google connection couldn't finish.";
        page(response, `${detail} Return to wing in iMessage and ask for a new Calendar link. Error: ${stage}.`, "", 400);
      }
      return true;
    },
  };
}
export type Calendar = ReturnType<typeof createCalendar>;
