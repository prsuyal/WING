import type { Message, Space } from "spectrum-ts";
import type { Database } from "./database.ts";
import { memoryNamespace } from "./memory.ts";
import type { Actor } from "./contracts.ts";

type Chat = Pick<Space, "id" | "responding"> & { type: "dm" | "group"; send(text: string): Promise<unknown> };
type Incoming = Pick<Message, "id" | "direction" | "content" | "sender">;

export function createService(database: Database, projectId: string, handle: (space: Chat, message: Incoming, actor: Actor) => Promise<void>) {
  return async (space: Chat, message: Incoming) => {
    if (space.type !== "dm" || message.direction !== "inbound" || !message.sender) return;
    const content = message.content;
    if (content.type !== "text" && (content.type !== "attachment" || !content.mimeType.startsWith("image/"))) return;
    const received = await database.receive(memoryNamespace(projectId, message.sender.__platform, message.sender.id), space.id, message.id,
      content.type === "text" ? { type: "text", text: content.text } : { type: "attachment", mimeType: content.mimeType, name: content.name ?? "image", size: content.size });
    if (!received.isNew) return;
    let replyIndex = 0;
    const persistedSpace: Chat = {
      id: space.id, type: space.type, responding: (fn) => space.responding(fn),
      send: async (text) => {
        const replyId = await database.prepareReply(received, space.id, text, replyIndex++);
        try {
          const result = await space.send(text);
          await database.status(received.userId, replyId, "sent");
          return result;
        } catch {
          await database.status(received.userId, replyId, "delivery_unknown");
          throw new Error("Reply delivery is unconfirmed; do not resend automatically");
        }
      },
    };
    try {
      await handle(persistedSpace, content.type === "attachment" ? { ...message, content: { ...content, read: async () => {
        const bytes = await content.read();
        await database.saveImage(received, content.mimeType, bytes);
        return bytes;
      } } } : message, { userId: received.userId, sourceMessageId: received.messageId,
        namespace: memoryNamespace(projectId, message.sender.__platform, message.sender.id), sourceText: content.type === "text" ? content.text : "" });
      await database.status(received.userId, received.messageId, "handled");
    } catch {
      await database.status(received.userId, received.messageId, "failed");
      throw new Error("Persisted message needs reconciliation");
    }
  };
}
