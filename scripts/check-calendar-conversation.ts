import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";
import { createDatabase } from "../src/database.ts";
import { createCalendar, formatCalendarChoices } from "../src/calendar.ts";
import { credentialVault } from "../src/credentials.ts";
import { memoryNamespace } from "../src/memory.ts";
import { createProfileStore } from "../src/profile.ts";
import { createScheduleStore } from "../src/schedule-store.ts";
import { createAgent } from "../src/agent.ts";
import type { Actor } from "../src/contracts.ts";
import { createAnthropic } from "@ai-sdk/anthropic";
loadEnvFile();
const model = createAnthropic({ headers: process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : undefined })(process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5");
const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const database = createDatabase(client), namespace = memoryNamespace(process.env.PROJECT_ID!, "imessage", `calendar_conversation_${randomUUID()}`), owners: string[] = [];
let reverse = false, single = false, googleCalls = 0;
const choices = Array.from({ length: 7 }, (_, index) => ({ id: `synthetic_${index + 1}`, summary: index === 6 ? "Personal" : `Calendar ${index + 1}`, timeZone: "America/New_York", accessRole: "owner", primary: index === 6 }));
const config = { baseUrl: "http://localhost:3000", clientId: "synthetic-client", clientSecret: "synthetic-secret", encryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY!, fetch: async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  assert.equal(init?.method ?? "GET", "GET"); assert.ok(String(input).includes("users/me/calendarList")); googleCalls++;
  return new Response(JSON.stringify({ items: single ? choices.slice(6) : reverse ? choices.toReversed() : choices }));
} };
let calendar = createCalendar(client, config);
async function source(text: string, identity = namespace): Promise<Actor> {
  const row = await database.receive(identity, identity, randomUUID(), { type: "text", text }); if (!owners.includes(row.userId)) owners.push(row.userId);
  return { userId: row.userId, sourceMessageId: row.messageId, namespace: identity, sourceText: text };
}
async function present(actor: Actor, text: string, status: "sent" | "delivery_unknown" = "sent") { const id = await database.prepareReply({ userId: actor.userId, messageId: actor.sourceMessageId, isNew: true }, actor.namespace, text, 0); await database.status(actor.userId, id, status); }
async function show() { const actor = await source("show my calendars"), text = await calendar.conversation(actor); assert.ok(text); await present(actor, text); return actor; }
try {
  const actor = await source("connect my calendar"), vault = credentialVault(process.env.CREDENTIAL_ENCRYPTION_KEY!);
  const { error } = await client.from("wing_calendar_connections").insert({ owner_id: actor.userId, status: "connected", credentials_cipher: vault.seal(actor.userId, { access: "synthetic-access", refresh: "synthetic-refresh", expiry: Date.now() + 3_600_000, scopes: ["https://www.googleapis.com/auth/calendar.events.owned"] }), selected_ids: [], choices: [], windows: [] }); assert.equal(error, null);
  await present(actor, "let's do it! connect here\nhttps://example.invalid/private-link\nthen come back and say done");
  const done = await source("done"), list = await calendar.conversation(done); assert.equal(list, formatCalendarChoices(choices)); assert.doesNotMatch(list!, /\/calendars|\/use-calendar/); await present(done, list!);
  reverse = true; calendar = createCalendar(client, config);
  const seven = await source("7"), reply = await calendar.conversation(seven); assert.match(reply!, /Personal/); assert.deepEqual((await calendar.state(actor.userId)).selected, ["synthetic_7"]); await present(seven, reply!);
  console.log(JSON.stringify({ check: "done_lists_choices_and_plain_number_survives_restart_and_google_reordering", status: "passed" }));
  await show(); const multiple = await source("1, 7"); await calendar.conversation(multiple); assert.deepEqual((await calendar.state(actor.userId)).selected, ["synthetic_7", "synthetic_1"]);
  assert.equal((await calendar.writeTarget(actor.userId)).calendarId, "synthetic_7");
  await show(); await calendar.conversation(await source("Personal")); assert.deepEqual((await calendar.state(actor.userId)).selected, ["synthetic_7"]);
  await show(); await calendar.conversation(await source("primary")); assert.deepEqual((await calendar.state(actor.userId)).selected, ["synthetic_7"]);
  console.log(JSON.stringify({ check: "multiple_numbers_name_and_primary_select_real_saved_ids", status: "passed" }));
  await show(); const bad = await calendar.conversation(await source("99")); assert.match(bad!, /pick a number/); assert.deepEqual((await calendar.state(actor.userId)).selected, ["synthetic_7"]);
  await show(); await assert.rejects(calendar.select(await source("7"), ["1"]), /must match your reply/);
  const other = await source("7", memoryNamespace(process.env.PROJECT_ID!, "imessage", `other_calendar_${randomUUID()}`)); assert.equal(await calendar.conversation(other), null); await assert.rejects(calendar.select(other, ["7"]));
  await show(); await present(await source("different question"), "what's your flight budget?"); const count = googleCalls; assert.equal(await calendar.conversation(await source("7")), null); await assert.rejects(calendar.select(await source("7"), ["7"])); assert.equal(googleCalls, count);
  const unsent = await source("show my calendars"), unsentList = await calendar.conversation(unsent); await present(unsent, unsentList!, "delivery_unknown"); await assert.rejects(calendar.select(await source("7"), ["7"]));
  console.log(JSON.stringify({ check: "invalid_numbers_other_owners_intervening_questions_and_unknown_delivery_never_select", status: "passed" }));
  const profiles = createProfileStore(client); await profiles.patch(await source("I usually fly from EWR"), { departureAirport: "EWR" }, "confirmed"); await profiles.onboarding(await source("start setup"), { introduced: true, active: true, skipped: [] });
  await show(); const agent = createAgent(model, profiles, { calendar, schedules: createScheduleStore(client) }), pick = await source("7");
  const resumed = await agent([{ role: "user", content: "7" }], "", pick); assert.match(resumed, /all set|nice|perfect|got|schedule|calendar/i); assert.match(resumed, /home|frequent|often|usually/i); assert.doesNotMatch(resumed, /\/(?:use-calendar|calendars)/);
  await show(); const contextAgent = createAgent(model, profiles, { calendar, schedules: createScheduleStore(client) }, undefined, { state: async () => [], command: async () => { throw new Error("A calendar choice must never reach flight selection"); } } as any);
  const expectedChoice = (await calendar.state(actor.userId)).choices?.[6]?.id;
  const contextual = await source("choose 7"); await contextAgent([{ role: "user", content: "choose 7" }], "", contextual); assert.deepEqual((await calendar.state(actor.userId)).selected, [expectedChoice]);
  console.log(JSON.stringify({ check: "model_interprets_calendar_choices_and_resumes_onboarding_without_slash_commands", status: "passed" }));
  single = true;
  await show(); assert.match((await calendar.conversation(await source("yup")))!, /all set/); assert.deepEqual((await calendar.state(actor.userId)).selected, ["synthetic_7"]);
  console.log(JSON.stringify({ check: "single_calendar_accepts_yup_and_multiple_selected_calendars_write_only_to_the_reviewed_primary", status: "passed" }));
} finally {
  for (const owner of owners) { const { error } = await client.from("wing_users").delete().eq("id", owner); if (error) throw new Error("Disposable calendar fixture cleanup failed"); }
}
