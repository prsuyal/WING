import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Supermemory } from "supermemory";
import { confirmedFacts, profilePatchSchema, tripPatchSchema } from "./profile.ts";
import { profileMemoryNamespace, tripMemoryNamespace } from "./memory.ts";

const documentSchema = z.object({ currentTravelFacts: z.unknown(), tripId: z.uuid().nullable(), version: z.number().int().positive() }).strict();
export function permittedMemory(content: string) {
  const document = documentSchema.parse(JSON.parse(content));
  return { ...document, currentTravelFacts: (document.tripId ? tripPatchSchema : profilePatchSchema).parse(document.currentTravelFacts) };
}
export function createMemoryWorker(client: SupabaseClient, memory: { add: (...args: Parameters<Supermemory["add"]>) => PromiseLike<unknown> }) {
  let running = false;
  return async (ownerId?: string) => {
    if (running) return;
    running = true;
    try {
      const { data, error } = await client.rpc("wing_claim_memory", { p_owner: ownerId ?? null });
      if (error) throw new Error("Memory queue claim failed");
      for (const document of data ?? []) {
        try {
          const permitted = permittedMemory(document.content);
          const { data: owner, error: ownerError } = await client.from("wing_users").select("identity_key").eq("id", document.owner_id).single();
          if (ownerError || !owner) throw new Error("Memory owner unavailable");
          const namespace = permitted.tripId ? tripMemoryNamespace(owner.identity_key, permitted.tripId) : profileMemoryNamespace(owner.identity_key);
          if (!permitted.tripId) {
            const { data: profile, error } = await client.from("wing_profiles").select("facts,version").eq("owner_id", document.owner_id).single();
            if (error || !profile) throw new Error("Current profile unavailable");
            permitted.currentTravelFacts = profilePatchSchema.parse(confirmedFacts(profile.facts));
            permitted.version = profile.version;
          }
          await memory.add(namespace, { id: permitted.tripId ? document.document_id : `profile_${document.owner_id}`, content: JSON.stringify(permitted), taskType: "memory", dreaming: "instant",
            metadata: { sourceMessageId: document.source_message_id, scope: permitted.tripId ? "trip" : "profile" },
            supportingContext: "These are permitted travel facts from the user's own message. A newer version replaces older values. Trip-specific facts apply only to this trip, never the general profile. No address, payment, credentials or calendar contents are included." },
          { timeoutInSeconds: 8, maxRetries: 0 });
          const { error: completeError } = await client.from("wing_memory_documents").update({ state: "done", indexed_at: new Date().toISOString(), leased_until: null }).eq("id", document.id).eq("owner_id", document.owner_id);
          if (completeError) throw new Error("Memory queue acknowledgment failed");
        } catch {
          const dueAt = new Date(Date.now() + Math.min(3600, 30 * 2 ** Math.min(document.attempts, 7)) * 1000).toISOString();
          const { error: retryError } = await client.from("wing_memory_documents").update({ state: "pending", due_at: dueAt, leased_until: null }).eq("id", document.id).eq("owner_id", document.owner_id);
          if (retryError) console.error("Memory retry update failed; lease recovery will retry. No private content logged.");
          else console.error("Travel memory indexing deferred for retry. No private content logged.");
        }
      }
    } finally { running = false; }
  };
}
