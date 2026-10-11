import assert from "node:assert/strict";
import test from "node:test";
import { chatBubbles, chatText } from "./texting.ts";

test("texting keeps URL tokens exact while lowercasing prose and removing em dashes", () => {
  const url = "https://example.com/Callback?t=AbCdEf&code=XYz";
  assert.equal(chatText(`Nice! — EWR to SFO.\n${url}`), `nice!, ewr to sfo\n${url}`);
  assert.equal(chatText("123 Demo Lane"), "123 demo lane");
  assert.equal(chatText("$300.50\n[DEMO] flight."), "$300.50\n[simulated] flight");
});

test("distinct thoughts become separate short bubbles without breaking lists or URLs", () => {
  const url = `https://example.com/Callback?t=${"ABC".repeat(150)}`;
  const bubbles = chatBubbles(`Hey!\n\n1. Primary\n2. Work\n\n${url}\n\n${"word ".repeat(200)}`);
  assert.deepEqual(bubbles.slice(0, 3), ["hey!", "1. primary\n2. work", url]);
  assert.equal(bubbles[3], "word ".repeat(200).trim());
  assert.ok(bubbles.every((bubble) => !bubble.includes("\n\n")));
});

test("single newlines and multiple sentences separate complete thoughts without breaking decimal prices or inline URLs", () => {
  assert.deepEqual(chatBubbles("nice!\nwant to connect google calendar?"), ["nice!", "want to connect google calendar?"]);
  assert.deepEqual(chatBubbles("got you! Want a ride?"), ["got you!", "want a ride?"]);
  assert.deepEqual(chatBubbles("it costs $300.50\nconnect here https://example.com/Callback?t=AbCd"), ["it costs $300.50", "connect here https://example.com/Callback?t=AbCd"]);
});
