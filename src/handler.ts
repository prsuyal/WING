import type { Message, Space } from "spectrum-ts";
import type { ModelMessage } from "ai";
import { createHash } from "node:crypto";
import { memoryNamespace, type Memory } from "./memory.ts";
import type { Actor } from "./contracts.ts";

type Chat = Pick<Space, "id" | "responding"> & {
  type: "dm" | "group";
  send(content: string): Promise<unknown>;
};
type Incoming = Pick<Message, "id" | "direction" | "content" | "sender">;

export function createHandler(generate: (messages: ModelMessage[], context: string, actor?: Actor) => Promise<string>, memory: Memory, projectId: string) {
  // Recent conversation context is disposable; createService provides persistent event deduplication.
  const history = new Map<string, ModelMessage[]>();
  const seen = new Set<string>();
  return async (space: Chat, message: Incoming, actor?: Actor) => {
    const key = `${space.id}:${message.id}`;
    if (space.type !== "dm" || message.direction !== "inbound" || seen.has(key) || !message.sender) return;
    const namespace = memoryNamespace(projectId, message.sender.__platform, message.sender.id);
    const historyKey = `${namespace}:${space.id}`;
    seen.add(key);
    if (seen.size > 500) seen.delete(seen.values().next().value!);

    if (message.content.type === "attachment") {
      if (!message.content.mimeType.startsWith("image/")) return;
      const maxBytes = 5 * 1024 * 1024;
      if ((message.content.size ?? 0) > maxBytes) {
        await space.send("please send an image smaller than 5 MB.");
        return;
      }
      try {
        const data = await message.content.read();
        if (!data.length || data.length > maxBytes) throw new Error("Invalid image size");
        console.log(JSON.stringify({ event: "image_downloaded", bytes: data.length, mimeType: message.content.mimeType }));
      } catch {
        await space.send("i couldn't download that image. try a smaller PNG or JPEG.");
        return;
      }
      await space.send("got your image — Photon download works. schedule interpretation isn't connected yet.");
      return;
    }
    if (message.content.type !== "text") return;
    const text = message.content.text.trim();
    if (!text) return;
    if (text === "/fresh") {
      history.delete(historyKey);
      await space.send("fresh conversation context. your saved preferences, trips, addresses and memory are still there.");
      return;
    }
    if (text === "/test-proactive") {
      await space.send("i'll send one test text in 10 seconds to check reminders. this doesn't enable ongoing notifications.");
      setTimeout(() => {
        void space.send("wing reminder test — this was sent after your request finished.")
          .then(() => console.log(JSON.stringify({ event: "proactive_probe", status: "provider_accepted", receipt: "unverified" })))
          .catch(() => console.error(JSON.stringify({ event: "proactive_probe", status: "unavailable_or_unconfirmed" })));
      }, 10_000);
      return;
    }
    const messages: ModelMessage[] = [...(history.get(historyKey) ?? []), { role: "user", content: text }];
    await space.responding(async () => {
      let context = "";
      try {
        // Search queries must not forward raw addresses, credentials or calendar text to Supermemory.
        context = await memory.recall(namespace, "travel preferences, home and departure airports, budget, arrival before dinner with family");
      } catch {
        console.error("Supermemory recall failed; continuing without memory. No private content or credentials logged.");
      }
      let reply: string;
      try {
        reply = await generate(messages, context, actor);
      } catch {
        console.error("Claude request failed; no private content or credentials logged.");
        await space.send("i couldn't reach Claude just now. please try again in a moment.");
        return;
      }
      await space.send(reply);
      history.set(historyKey, [...messages, { role: "assistant" as const, content: reply }].slice(-20));
      if (history.size > 100) history.delete(history.keys().next().value!);
      try {
        await memory.remember(namespace, {
          id: `msg_${createHash("sha256").update(key).digest("hex")}`, text, reply,
        });
      } catch {
        console.error("Supermemory save failed; delivered reply was not saved. No private content or credentials logged.");
      }
    });
  };
}
