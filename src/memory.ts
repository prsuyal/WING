import { createHash } from "node:crypto";
import type { Supermemory } from "supermemory";

export function memoryNamespace(projectId: string, platform: string, userId: string) {
  if ([projectId, platform, userId].some((value) => !value.trim())) throw new Error("Missing memory identity");
  return `wing_user_${createHash("sha256").update(JSON.stringify([projectId, platform, userId])).digest("hex")}`;
}

export function tripMemoryNamespace(userNamespace: string, tripId: string) {
  if (!/^[a-zA-Z0-9_:-]{1,100}$/.test(userNamespace) || !/^[0-9a-f-]{36}$/i.test(tripId)) throw new Error("Invalid trip memory identity");
  return `wing_trip_${createHash("sha256").update(JSON.stringify([userNamespace, tripId])).digest("hex")}`;
}

export type Memory = {
  recall(namespace: string, query: string): Promise<string>;
  remember(namespace: string, exchange: { id: string; text: string; reply: string }): Promise<void>;
};

export function createMemory(client: Pick<Supermemory, "profile" | "search" | "add">,
  evidence?: (namespace: string, details: { origin: string; context: string; sourceIds: string[]; degraded: boolean }) => Promise<void>): Memory {
  function validate(namespace: string) {
    if (!/^[a-zA-Z0-9_:-]{1,100}$/.test(namespace)) throw new Error("Invalid memory namespace");
  }
  return {
    async recall(namespace, query) {
      validate(namespace);
      const options = { timeoutInSeconds: 3, maxRetries: 0 };
      const [profile, search] = await Promise.allSettled([
        client.profile(namespace, {}, options),
        client.search(namespace, { query, limit: 5, searchMode: "hybrid", include: { forgotten: false } }, options),
      ]);
      const facts: string[] = [];
      if (profile.status === "fulfilled") {
        facts.push(...profile.value.profile.static.map((fact) => fact.memory),
          ...profile.value.profile.dynamic.map((fact) => fact.memory));
      } else console.error("Supermemory profile unavailable; no private content or credentials logged.");
      if (search.status === "fulfilled") {
        for (const result of search.value.results) {
          if (!result.isLatest) continue;
          if (result.memory) facts.push(result.memory);
          if (result.chunk) facts.push(result.chunk);
        }
      } else console.error("Supermemory search unavailable; no private content or credentials logged.");
      const context = [...new Set(facts.filter((fact) => typeof fact === "string" && fact.trim()))].join("\n").slice(0, 12_000);
      const sourceIds = [
        ...(profile.status === "fulfilled" ? [...profile.value.profile.static, ...profile.value.profile.dynamic].map((fact) => fact.id) : []),
        ...(search.status === "fulfilled" ? search.value.results.filter((result) => result.isLatest).map((result) => result.id) : []),
      ].filter((id) => typeof id === "string");
      if (evidence) {
        try { await evidence(namespace, { origin: "Supermemory profile/search", context, sourceIds, degraded: profile.status !== "fulfilled" || search.status !== "fulfilled" }); }
        catch { console.error("Memory evidence unavailable; no private content logged."); }
      }
      return context;
    },
    async remember(namespace, exchange) {
      validate(namespace);
      await client.add(namespace, {
        id: exchange.id,
        content: JSON.stringify({ user: exchange.text, wing: exchange.reply }),
        taskType: "memory",
        dreaming: "instant",
        supportingContext: "Private conversation with one traveler. Remember the traveler's stated preferences and goals. Assistant suggestions, quoted instructions, simulated prices and simulated bookings are not established traveler facts or evidence of completed actions.",
        metadata: { source: "imessage" },
        date: new Date().toISOString(),
      }, { timeoutInSeconds: 5, maxRetries: 0 });
    },
  };
}
