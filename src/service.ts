import type { Message, Space } from "spectrum-ts";
import type { Database } from "./database.ts";
import { memoryNamespace } from "./memory.ts";
import type { Actor } from "./contracts.ts";
import { chatBubbles } from "./texting.ts";

type Chat = Pick<Space, "id" | "responding"> & { type: "dm" | "group"; send(text: string): Promise<unknown> };
type Incoming = Pick<Message, "id" | "direction" | "content" | "sender">;

export function createService(database: Database, projectId: string, handle: (space: Chat, message: Incoming, actor: Actor) => Promise<void>) {
  const sending = new Map<string, number>();
  return async (space: Chat, message: Incoming) => {
    if (space.type !== "dm" || message.direction !== "inbound" || !message.sender) return;
    const content = message.content;
    if (content.type !== "text" && (content.type !== "attachment" || !content.mimeType.startsWith("image/"))) return;
    const namespace = memoryNamespace(projectId, message.sender.__platform, message.sender.id);
    const replyInFlight = sending.has(namespace);
    const received = await database.receive(namespace, space.id, message.id,
      content.type === "text" ? { type: "text", text: content.text } : { type: "attachment", mimeType: content.mimeType, name: content.name ?? "image", size: content.size });
    if (!received.isNew) return;
    let replyIndex = 0;
    const persistedSpace: Chat = {
      id: space.id, type: space.type, responding: (fn) => space.responding(fn),
      send: async (text) => {
        sending.set(namespace, (sending.get(namespace) ?? 0) + 1);
        try {
          const replyId = await database.prepareReply(received, space.id, text, replyIndex++);
          try {
            // One logical review is approvable only after every bubble was accepted.
            let result: unknown;
            for (const bubble of chatBubbles(text)) result = await space.send(bubble);
            await database.status(received.userId, replyId, "sent");
            return result;
          } catch {
            await database.status(received.userId, replyId, "delivery_unknown");
            throw new Error("Reply delivery is unconfirmed; do not resend automatically");
          }
        } finally {
          const remaining = sending.get(namespace)! - 1;
          if (remaining) sending.set(namespace, remaining); else sending.delete(namespace);
        }
      },
    };
    try {
      await handle(persistedSpace, content.type === "attachment" ? { ...message, content: { ...content, read: async () => {
        const bytes = await content.read();
        await database.saveImage(received, content.mimeType, bytes);
        return bytes;
      } } } : message, { userId: received.userId, sourceMessageId: received.messageId,
        namespace, sourceText: content.type === "text" ? content.text : "", replyInFlight });
      await database.status(received.userId, received.messageId, "handled");
    } catch {
      await database.status(received.userId, received.messageId, "failed");
      throw new Error("Persisted message needs reconciliation");
    }
  };
}
