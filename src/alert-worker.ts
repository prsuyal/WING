import type { SupabaseClient } from "@supabase/supabase-js";
import type { FlightPlanner } from "./flight-store.ts";
import { priceNotice } from "./notifications.ts";
import { z } from "zod";

export type NoticeTransport = { resolve: (spaceId: string) => Promise<(text: string) => Promise<void>> };
const reminderSchema = z.object({ text: z.string().min(1).max(1200), expiresAt: z.iso.datetime(), timeZone: z.string(), flightActionId: z.uuid() });
export function createAlertWorker(client: SupabaseClient, flights: FlightPlanner, transport: NoticeTransport) {
  let running = false;
  async function processJob(job: any) {
    let completed = false;
    try {
      if (job.kind === "watch") {
        const { data: watch, error } = await client.from("wing_watches").select("*").eq("owner_id", job.owner_id).eq("id", job.watch_id).single();
        if (error) throw new Error("Watch job unavailable");
        if (watch.status !== "active") { await finish(job, "cancelled"); return; }
        const quote = await flights.watchQuote(job.owner_id, watch.search_id, watch.comparison_key);
        if (quote.status === "changed") { await client.from("wing_watches").update({ status: "changed" }).eq("owner_id", job.owner_id).eq("id", watch.id).eq("status", "active"); await finish(job, "cancelled"); return; }
        if (quote.status === "unknown") throw new Error("Calendar availability unknown");
        if (quote.status === "available") {
          const { data: trip, error: tripError } = await client.from("wing_trips").select("title").eq("owner_id", job.owner_id).eq("id", job.trip_id).single();
          if (tripError) throw new Error("Watch trip unavailable");
          const result = await client.rpc("wing_observe_watch", { p_owner: job.owner_id, p_watch: watch.id, p_job: job.id, p_lease: job.lease, p_price: quote.offer!.totalCents, p_version: quote.offer!.version, p_text: priceNotice(trip.title, quote.offer!.totalCents, watch.anchor_cents, quote.offer!.simulated) });
          if (result.error) throw new Error("Price observation unavailable");
        }
        await finish(job, "pending", 6 * 3600_000);
      } else {
        const payload = reminderSchema.parse(job.payload);
        const { data: reservation, error } = await client.from("wing_flight_reservations").select("action_id").eq("owner_id", job.owner_id).eq("trip_id", job.trip_id).eq("action_id", payload.flightActionId).maybeSingle();
        if (error) throw new Error("Reminder reservation unavailable");
        if (!reservation || Date.parse(payload.expiresAt) <= Date.now()) { await finish(job, "cancelled"); return; }
        const { error: noticeError } = await client.from("wing_notices").insert({ owner_id: job.owner_id, trip_id: job.trip_id, job_id: job.id, source_message_id: job.source_message_id, payload: { text: payload.text }, time_zone: payload.timeZone, expires_at: payload.expiresAt });
        if (noticeError && noticeError.code !== "23505") throw new Error("Reminder outbox unavailable");
        await finish(job, "done");
      }
      completed = true;
    } catch {
      if (!completed) await finish(job, "pending", Math.min(3600_000, 30_000 * 2 ** Math.min(job.attempts, 7)));
      console.error(JSON.stringify({ event: "alert_job_deferred", kind: job.kind, privateContentLogged: false }));
    }
  }
  async function finish(job: any, status: "pending" | "done" | "cancelled", delay = 0) {
    const { error } = await client.rpc("wing_finish_alert_job", { p_owner: job.owner_id, p_job: job.id, p_lease: job.lease, p_status: status, p_delay: delay });
    if (error) throw new Error("Job completion unavailable");
  }
  async function sendNotice(notice: any) {
    let started = false;
    try {
      if (notice.watch_id) {
        const { data: watch, error } = await client.from("wing_watches").select("status,search_id,comparison_key").eq("owner_id", notice.owner_id).eq("id", notice.watch_id).single();
        if (error) throw new Error("Watch delivery check unavailable");
        const quote = watch.status === "active" ? await flights.watchQuote(notice.owner_id, watch.search_id, watch.comparison_key) : { status: "changed" };
        if (quote.status === "unknown") throw new Error("Calendar availability unknown");
        if (quote.status !== "available" || !("offer" in quote) || quote.offer!.totalCents !== notice.payload.totalCents || quote.offer!.version !== notice.payload.offerVersion) {
          await client.from("wing_notices").update({ status: "cancelled" }).eq("owner_id", notice.owner_id).eq("id", notice.id).eq("status", "claimed").eq("lease", notice.lease);
          return;
        }
      }
      const { data: parent, error } = await client.from("wing_messages").select("space_id").eq("owner_id", notice.owner_id).eq("id", notice.source_message_id).eq("direction", "inbound").single();
      if (error) throw new Error("Notice recipient unavailable");
      const send = await transport.resolve(parent.space_id);
      const { data: messageId, error: beginError } = await client.rpc("wing_begin_notice", { p_owner: notice.owner_id, p_notice: notice.id, p_lease: notice.lease, p_payload: notice.payload });
      if (beginError) throw new Error("Notice preparation unavailable");
      if (!messageId) return;
      started = true;
      await send(z.string().min(1).max(1600).parse(notice.payload.text));
      const { error: finishError } = await client.rpc("wing_finish_notice", { p_owner: notice.owner_id, p_notice: notice.id, p_lease: notice.lease, p_status: "sent" });
      if (finishError) throw new Error("Notice delivery acknowledgment unavailable");
    } catch {
      if (started) {
        await client.rpc("wing_finish_notice", { p_owner: notice.owner_id, p_notice: notice.id, p_lease: notice.lease, p_status: "unknown" });
        console.error(JSON.stringify({ event: "notice_delivery_unconfirmed", automaticResend: false }));
      } else {
        await client.from("wing_notices").update({ status: "pending", due_at: new Date(Date.now() + Math.min(3600_000, 30_000 * 2 ** Math.min(notice.attempts, 7))).toISOString(), lease: null, leased_until: null }).eq("owner_id", notice.owner_id).eq("id", notice.id).eq("status", "claimed").eq("lease", notice.lease);
      }
    }
  }
  return async (owner?: string) => {
    if (running) return;
    running = true;
    try {
      const { data: jobs, error } = await client.rpc("wing_claim_jobs", { p_owner: owner ?? null });
      if (error) throw new Error("Job claims unavailable");
      await Promise.all((jobs ?? []).map(processJob));
      const { data: notices, error: noticeError } = await client.rpc("wing_claim_notices", { p_owner: owner ?? null });
      if (noticeError) throw new Error("Notice claims unavailable");
      await Promise.all((notices ?? []).map(sendNotice));
    } finally { running = false; }
  };
}
