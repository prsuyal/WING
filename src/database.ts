import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { messageBodySchema, receivedSchema, type Received } from "./contracts.ts";

export function createDatabase(client: SupabaseClient) {
  return {
    async receive(identityKey: string, spaceId: string, providerId: string, body: z.infer<typeof messageBodySchema>) {
      const { data, error } = await client.rpc("wing_receive_message", {
        p_identity_key: identityKey, p_space_id: z.string().min(1).max(512).parse(spaceId),
        p_provider_id: z.string().min(1).max(512).parse(providerId), p_body: messageBodySchema.parse(body),
      });
      if (error) throw new Error("Message persistence failed");
      return receivedSchema.parse(data);
    },
    async prepareReply(received: Received, spaceId: string, text: string, replyIndex: number) {
      const { data, error } = await client.from("wing_messages").insert({
        owner_id: received.userId, parent_id: received.messageId, space_id: spaceId,
        provider_id: `reply_${received.messageId}_${replyIndex}`, direction: "outbound", body: { type: "text", text }, status: "prepared",
      }).select("id").single();
      if (error) throw new Error("Reply persistence failed");
      return z.uuid().parse(data.id);
    },
    async status(userId: string, messageId: string, status: "sent" | "handled" | "failed" | "delivery_unknown") {
      const { data, error } = await client.from("wing_messages").update({ status }).eq("owner_id", userId).eq("id", messageId).select("id").single();
      if (error || !data) throw new Error("Message status update failed");
    },
    async saveImage(received: Received, mimeType: string, data: Uint8Array) {
      if (!mimeType.startsWith("image/") || !data.length || data.length > 5 * 1024 * 1024) throw new Error("Invalid image");
      const path = `${received.userId}/${received.messageId}`;
      const { data: row, error: updateError } = await client.from("wing_messages").select("body").eq("owner_id", received.userId).eq("id", received.messageId).single();
      if (updateError || !row) throw new Error("Attachment owner lookup failed");
      const { error } = await client.storage.from("wing-attachments").upload(path, data, { contentType: mimeType, upsert: false });
      if (error) throw new Error("Private image upload failed");
      const { error: saveError } = await client.from("wing_messages").update({ body: { ...row.body, storagePath: path, size: data.length } }).eq("owner_id", received.userId).eq("id", received.messageId);
      if (saveError) throw new Error("Attachment metadata save failed");
      return path;
    },
  };
}
export type Database = ReturnType<typeof createDatabase>;
