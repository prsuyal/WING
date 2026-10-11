import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createCalendar, formatCalendarChoices, matchesCalendarChoices, calendarReferences } from "./calendar.ts";
import { createHttpServer } from "./http.ts";

test("calendar numbers and names are conversational while ambiguous answers don't silently select", () => {
  const choices = Array.from({ length: 7 }, (_, index) => ({ id: `calendar_${index + 1}`, summary: index === 6 ? "Personal" : `Calendar ${index + 1}`, timeZone: "America/New_York", accessRole: "owner", primary: index === 6 }));
  assert.deepEqual(calendarReferences("7", choices), ["7"]);
  assert.deepEqual(calendarReferences("use 7 please", choices), ["7"]);
  assert.deepEqual(calendarReferences("let’s do 7", choices), ["7"]);
  assert.deepEqual(calendarReferences("1, 7", choices), ["1", "7"]);
  assert.deepEqual(calendarReferences("1 and 7", choices), ["1", "7"]);
  assert.deepEqual(calendarReferences("Personal", choices), ["Personal"]);
  assert.deepEqual(calendarReferences("my primary calendar", choices), ["primary"]);
  assert.equal(calendarReferences("7 or 3", choices), null);
  const text = formatCalendarChoices(choices);
  assert.doesNotMatch(text, /\/use-calendar|reader|owner/);
  assert.equal(matchesCalendarChoices(text, choices), true);
  assert.equal(matchesCalendarChoices(text, choices.toReversed()), false);
  assert.equal(matchesCalendarChoices("book flight option 7?", choices), false);
  const legacy = `${choices.map((choice, i) => `${i + 1}. ${choice.summary}${choice.primary ? " (primary)" : ""} — ${choice.accessRole}`).join("\n")}\ntext /use-calendar 1 (or numbers separated by commas) to choose.`;
  assert.equal(matchesCalendarChoices(legacy, choices), true);
});

test("connection errors identify the failed step without exposing private URL or credentials", async () => {
  const client = { from() { return { select() { return this; }, eq() { return this; }, is() { return this; }, gt() { return this; }, async single() { return { data: null, error: { message: "private database detail" } }; } }; } } as unknown as SupabaseClient;
  const calendar = createCalendar(client, { baseUrl: "http://localhost", clientId: "private-client", clientSecret: "private-secret", encryptionKey: "a".repeat(64) });
  const server = createHttpServer(calendar.http);
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const logs: string[] = [], original = console.error;
  console.error = (value) => { logs.push(String(value)); };
  try {
    const cases = [
      ["/auth/google/start", "link_format", "missing or incomplete"],
      [`/auth/google/start?t=${"x".repeat(43)}`, "link_lookup", "expired"],
      [`/auth/google/callback?state=${"x".repeat(43)}&code=private-code`, "callback_cookie", "browser session is missing"],
    ];
    for (const [path, stage, detail] of cases) {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
      assert.equal(response.status, 400);
      const body = await response.text();
      assert.ok(body.includes(detail!) && body.includes(`Error: ${stage}`));
      assert.equal(JSON.parse(logs.at(-1)!).stage, stage);
      for (const privateValue of ["private-client", "private-secret", "private-code", "private database detail", "x".repeat(43)]) assert.ok(!body.includes(privateValue) && !logs.join(" ").includes(privateValue));
    }
  } finally { console.error = original; server.close(); await once(server, "close"); }
});

test("the consent page permits same-origin form POSTs while rejecting opaque and foreign origins", async () => {
  let claims = 0;
  const client = { from() {
    let updating = false;
    return { select() { return this; }, eq() { return this; }, is() { return this; }, gt() { return this; }, update() { updating = true; return this; }, async single() { if (updating) claims++; return { data: { owner_id: "synthetic-owner", token_hash: "synthetic-hash" }, error: null }; } };
  } } as unknown as SupabaseClient;
  let calendar: ReturnType<typeof createCalendar>;
  const server = createHttpServer((request, response) => calendar.http(request, response));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  calendar = createCalendar(client, { baseUrl: origin, clientId: "synthetic-client", clientSecret: "synthetic-secret", encryptionKey: "a".repeat(64) });
  try {
    const link = `${origin}/auth/google/start?t=${"x".repeat(43)}`;
    const landing = await fetch(link);
    assert.equal(landing.status, 200);
    assert.equal(landing.headers.get("referrer-policy"), "same-origin");
    assert.equal(landing.headers.get("content-security-policy")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("form-action ")), "form-action 'self' https://accounts.google.com");
    const cookie = landing.headers.get("set-cookie")!.split(";")[0]!;
    for (const invalid of ["null", "https://attacker.invalid"]) {
      assert.equal((await fetch(link, { method: "POST", headers: { Origin: invalid, Cookie: cookie }, redirect: "manual" })).status, 400);
      assert.equal(claims, 0);
    }
    const redirect = await fetch(link, { method: "POST", headers: { Origin: origin, Cookie: cookie }, redirect: "manual" });
    assert.equal(redirect.status, 303);
    assert.equal(claims, 1);
    assert.equal(redirect.headers.get("referrer-policy"), "no-referrer");
    assert.equal(new URL(redirect.headers.get("location")!).origin, "https://accounts.google.com");
  } finally { server.close(); await once(server, "close"); }
});
