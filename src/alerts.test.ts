import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAlerts } from "./alerts.ts";
import type { ProfileStore } from "./profile.ts";
import type { FlightPlanner } from "./flight-store.ts";
const owner = randomUUID(), first = { id: randomUUID(), title: "home visit" }, second = { id: randomUUID(), title: "conference" };
function fixture(trips = [first, second]) {
  const calls: any[] = [];
  const client = { async rpc(name: string, args: any) { assert.equal(name, "wing_stop_notifications"); calls.push(args); return { error: null }; } } as unknown as SupabaseClient;
  const profiles = { async state() { return { trips, activeTripId: second.id }; } } as unknown as ProfileStore;
  const alerts = createAlerts(client, profiles, {} as FlightPlanner);
  const actor = (sourceText: string) => ({ userId: owner, sourceMessageId: randomUUID(), namespace: "synthetic", sourceText });
  return { alerts, actor, calls };
}
test("ambiguous mute-this-trip never silently stops every trip", async () => {
  const { alerts, actor, calls } = fixture();
  await assert.rejects(alerts.stop(actor("mute this trip")), /Choose a specific trip/);
  await assert.rejects(alerts.stop(actor("mute this trip"), second.id), /Choose a specific trip/);
  assert.equal(calls.length, 0);
});
test("the user's named trip binds mute scope even when the model omits or guesses a reference", async () => {
  const { alerts, actor, calls } = fixture();
  assert.equal(await alerts.stop(actor("mute home visit")), "muted home visit");
  assert.equal(await alerts.stop(actor("mute home visit"), second.id), "muted home visit");
  assert.ok(calls.every((args) => args.p_owner === owner && args.p_trip === first.id));
});
test("explicit global stop clears any model-supplied scope; a sole trip can be muted directly", async () => {
  const { alerts, actor, calls } = fixture();
  assert.match(await alerts.stop(actor("stop"), second.id), /stopped future alerts/);
  assert.equal(calls[0].p_trip, null);
  const one = fixture([first]); assert.equal(await one.alerts.stop(one.actor("mute this trip")), "muted home visit"); assert.equal(one.calls[0].p_trip, first.id);
});
