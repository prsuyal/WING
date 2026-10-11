import assert from "node:assert/strict";
import test from "node:test";
import { MockLanguageModelV3 } from "ai/test";
import { interpretReply, presentReply } from "./conversation.ts";
import { understands, type Actor } from "./contracts.ts";

const actor: Actor = { userId: "owner", sourceMessageId: "current", namespace: "private-scope", sourceText: "yes but change the return" };
const result = (text: string) => ({ content: [{ type: "text" as const, text }], finishReason: { unified: "stop" as const, raw: "stop" }, warnings: [], usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } });

test("model interpretation replaces the legacy vocabulary and fails closed on errors", async () => {
  assert.equal(await understands({ ...actor, interpret: async () => false }, "approve", true), false);
  assert.equal(await understands({ ...actor, interpret: async () => true }, "approve", false), true);
  await assert.rejects(understands({ ...actor, interpret: async () => { throw new Error("API unavailable"); } }, "approve", true), /API unavailable/);
});

test("reply interpretation uses only current text and delivered context and caches the same decision within a turn", async () => {
  const model = new MockLanguageModelV3({ doGenerate: result('{"allowed":false}') });
  const interpret = interpretReply(model, actor, "save this exact round trip? reply yes");
  assert.equal(await interpret("approve unchanged flight"), false);
  assert.equal(await interpret("approve unchanged flight"), false);
  assert.equal(model.doGenerateCalls.length, 1);
  const prompt = JSON.stringify(model.doGenerateCalls[0]!.prompt);
  assert.ok(prompt.includes(actor.sourceText));
  assert.ok(prompt.includes("save this exact round trip?"));
  assert.ok(!prompt.includes(actor.namespace));
  await interpret("save a private address");
  assert.equal(model.doGenerateCalls.length, 2);
});

test("invalid model output never becomes a permissive interpretation", async () => {
  const interpret = interpretReply(new MockLanguageModelV3({ doGenerate: result('{"allowed":"yes"}') }), actor, "reply yes");
  await assert.rejects(interpret("approve unchanged flight"));
});


test("travel wording uses the model's separate thoughts only after a faithful rewrite check", async () => {
  const model = new MockLanguageModelV3({ doGenerate: [result('{"messages":["you leave newark on december 11 at 6:30 pm","save the simulated reservation for $950?"]}'), result('{"faithful":true}')] });
  const facts = "verified fare $950, ewr to bcn, december 11, 6:30 pm, simulated review";
  const text = await presentReply(model)(facts);
  assert.equal(text, "you leave newark on december 11 at 6:30 pm\n\nsave the simulated reservation for $950?");
  assert.equal(model.doGenerateCalls.length, 2);
  assert.ok(JSON.stringify(model.doGenerateCalls[1]!.prompt).includes(facts));
});

test("unfaithful or structured travel rewrites never become approval reviews", async () => {
  const unfaithful = new MockLanguageModelV3({ doGenerate: [result('{"messages":["your real uber is booked"]}'), result('{"faithful":false}')] });
  await assert.rejects(presentReply(unfaithful)("simulated ride review, no real dispatch"), /changed the verified facts/);
  const structured = new MockLanguageModelV3({ doGenerate: result('{"messages":["ewr → bcn · $950"]}') });
  await assert.rejects(presentReply(structured)("flight details"), /not conversational/);
  assert.equal(structured.doGenerateCalls.length, 1);
});


test("confirmation invitations are checked as confirmations, not premature calendar reviews", async () => {
  const model = new MockLanguageModelV3({ doGenerate: [result('{"messages":["your simulated pickup is reserved","want me to add the flights and pickup to google calendar?"]}'), result('{"faithful":true}')] });
  await presentReply(model)("ride reserved (simulated), no real dispatch\nadd the flights and pickup to your calendar?", "confirmation");
  for (const call of model.doGenerateCalls) {
    const message = call.prompt.find((part) => part.role === "user");
    assert.ok(message?.content[0]?.type === "text");
    assert.equal(JSON.parse(message.content[0].text).messageKind, "confirmation");
  }
});


test("related confirmation sentences stay in one message before verification", async () => {
  const model = new MockLanguageModelV3({ doGenerate: [result('{"messages":["Nice! Your simulated ride is saved."]}'), result('{"faithful":true}')] });
  assert.equal(await presentReply(model)("verified simulated ride confirmation", "confirmation"), "nice! your simulated ride is saved");
});
