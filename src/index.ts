import { loadEnvFile } from "node:process";
import { createHash } from "node:crypto";
import { Spectrum } from "spectrum-ts";
import { imessage } from "@spectrum-ts/imessage";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createHandler } from "./handler.ts";
import { Supermemory } from "supermemory";
import { createMemory } from "./memory.ts";
import { createClient } from "@supabase/supabase-js";
import { createDatabase } from "./database.ts";
import { createService } from "./service.ts";
import { chatBubbles } from "./texting.ts";
import { createHttpServer } from "./http.ts";
import { createProfileStore } from "./profile.ts";
import { createAgent } from "./agent.ts";
import { createMemoryWorker } from "./memory-worker.ts";
import { createCalendar } from "./calendar.ts";
import { createScheduleStore, createScheduleVision } from "./schedule-store.ts";
import { createFlightPlanner } from "./flight-store.ts";
import { createLiveFlights } from "./live-flights.ts";
import { createJourneys } from "./journey.ts";
import { createAlerts } from "./alerts.ts";
import { createAlertWorker } from "./alert-worker.ts";
import { createBookings } from "./booking.ts";

try { loadEnvFile(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
for (const name of ["PROJECT_ID", "PROJECT_SECRET", "ANTHROPIC_API_KEY", "SUPERMEMORY_API_KEY", "SUPABASE_URL", "SUPABASE_SECRET_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "CREDENTIAL_ENCRYPTION_KEY", "PUBLIC_BASE_URL"]) {
  if (!process.env[name]?.trim()) throw new Error(`Set ${name} in .env before starting wing.`);
}
const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
const anthropic = createAnthropic({
  headers: workspaceId ? { "anthropic-workspace-id": workspaceId } : undefined,
});
const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) },
});
const database = createDatabase(client);

const profiles = createProfileStore(client);
const supermemory = new Supermemory({ maxRetries: 0 });
const recalled = createMemory(supermemory, async (namespace, evidence) => {
  const { data, error } = await client.from("wing_users").select("id").eq("identity_key", namespace).single();
  if (error || !data) throw new Error("Memory owner lookup failed");
  await profiles.evidence(data.id, evidence);
});
const model = anthropic(process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5");
const calendar = createCalendar(client, { baseUrl: process.env.PUBLIC_BASE_URL!, clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET!, encryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY! });
const schedules = createScheduleStore(client);
const flights = createFlightPlanner(client, profiles, { calendar, schedules }, {
  airportBufferMinutes: Number(process.env.DEMO_AIRPORT_BUFFER_MINUTES || 120), originDriveMinutes: Number(process.env.DEMO_ORIGIN_DRIVE_MINUTES || 35),
  landingBufferMinutes: Number(process.env.DEMO_LANDING_BUFFER_MINUTES || 30), minimumHomeHours: Number(process.env.DEMO_MINIMUM_HOME_HOURS || 24),
}, createLiveFlights(process.env.SERPAPI_API_KEY || "", client));
const bookings = createBookings(client, profiles, flights);
const journeys = createJourneys(client, profiles, calendar);
const alerts = createAlerts(client, profiles, flights);
const agent = createAgent(model, profiles, { calendar, schedules }, flights, bookings, journeys, alerts);
const handle = createHandler(agent, {
  recall: recalled.recall,
  // Only validated travel facts enter the durable indexing queue; never forward raw chat exchanges.
  remember: async () => {},
}, process.env.PROJECT_ID!, createScheduleVision(model, schedules, { calendar, profiles }));
const indexMemories = createMemoryWorker(client, supermemory);
const processMessage = createService(database, process.env.PROJECT_ID!, handle);
const { error: databaseError } = await client.from("wing_users").select("id").limit(1);
if (databaseError) throw new Error("Supabase foundation is unavailable; apply the migration before starting wing.");
const { error: profileError } = await client.from("wing_profiles").select("owner_id").limit(1);
if (profileError) throw new Error("Profile schema unavailable; apply the Phase 1 migration before starting wing.");
const { error: flightError } = await client.from("wing_flight_searches").select("id").limit(1);
if (flightError) throw new Error("Flight schema unavailable; apply the Phase 3 migration before starting wing.");
const { error: bookingError } = await client.from("wing_flight_actions").select("id").limit(1);
if (bookingError) throw new Error("Booking schema unavailable; apply the Phase 4 migration before starting wing.");

const { error: journeyError } = await client.from("wing_journey_actions").select("id").limit(1);
if (journeyError) throw new Error("Journey schema unavailable; apply the Phase 5 migration before starting wing.");

const { error: alertError } = await client.from("wing_jobs").select("id").limit(1);
if (alertError) throw new Error("Alert schema unavailable; apply the Phase 7 migrations before starting wing.");

const app = await Spectrum({
  projectId: process.env.PROJECT_ID!,
  projectSecret: process.env.PROJECT_SECRET!,
  providers: [imessage.config()],
});
const server = createHttpServer(calendar.http);
server.listen(Number(process.env.PORT || 3000), "0.0.0.0");
server.on("error", () => { console.error("HTTP service failed to start."); process.exit(1); });
console.log("wing Phase 7 listening. Durable price watches and approved reminders enabled.");
const runAlerts = createAlertWorker(client, flights, { async resolve(spaceId) {
  const space = await imessage(app).space.get(spaceId);
  if (space.type !== "dm") throw new Error("Notice requires the existing private conversation");
  return async (text) => { for (const bubble of chatBubbles(text)) await space.send(bubble); };
} });
const alertTimer = setInterval(() => { void runAlerts().catch(() => console.error("Alert queue unavailable; persisted jobs will recover.")); }, 10000);
alertTimer.unref();
void runAlerts().catch(() => console.error("Alert startup deferred; jobs remain persisted."));
const memoryTimer = setInterval(() => { void indexMemories().catch(() => console.error("Memory queue unavailable; saved facts remain in Supabase.")); }, 5000);
memoryTimer.unref();
void indexMemories().catch(() => console.error("Memory queue startup deferred; saved facts remain in Supabase."));

const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 16);
for await (const [space, message] of imessage(app).messages) {
  if (message.direction !== "inbound") continue;
  const items = message.content.type === "group" ? message.content.items : [message];
  for (const item of items) {
    console.log(JSON.stringify({
      event: "inbound", message: fingerprint(item.id), chat: fingerprint(space.id),
      sender: item.sender ? fingerprint(item.sender.id) : null,
      chatType: space.type, contentType: item.content.type,
    }));
    try {
      await processMessage(space, item);
    } catch {
      // Sending may have succeeded before a timeout; do not blindly retry delivery.
      console.error("Message handling failed; delivery is unconfirmed. No automatic resend.");
    }
  }
}
