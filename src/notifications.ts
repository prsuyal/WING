import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { offerSchema } from "./contracts.ts";
import type { Offer } from "./flights.ts";

export function quietUntil(now: string, zone: string) {
  const local = Temporal.Instant.from(now).toZonedDateTimeISO(zone);
  if (local.hour >= 8 && local.hour < 22) return null;
  const date = local.toPlainDate().add({ days: local.hour >= 22 ? 1 : 0 });
  return date.toZonedDateTime({ timeZone: zone, plainTime: "08:00" }).toInstant().toString();
}
export function qualifiesPrice(price: number, anchor: number, mode: "target" | "drop", target: number | null, minimumDrop: number) {
  if (mode === "drop") return price <= anchor - minimumDrop;
  return target !== null && price <= target && (anchor > target || price <= anchor - minimumDrop);
}
export function adjustedOffer(offer: Offer, change?: { delta_cents: number; version: number }) {
  if (!change) return offer;
  if (!offer.simulated || offer.baggageFeeCents === null) throw new Error("Cannot apply simulated prices to a real quote");
  const delta = z.number().int().parse(change.delta_cents), version = z.number().int().positive().parse(change.version);
  const total = offer.totalCents + delta;
  if (total <= offer.baggageFeeCents || total > 200000) throw new Error("Invalid simulated fare adjustment");
  const fare = total - offer.baggageFeeCents, outward = Math.floor(fare / 2);
  return offerSchema.parse({ ...offer, version: 1 + version, totalCents: total, perPersonCents: total, outboundFareCents: outward, inboundFareCents: fare - outward,
    priceHistory: [...offer.priceHistory.slice(0, -1), { ...offer.priceHistory.at(-1)!, totalCents: total }] });
}
export function priceNotice(title: string, cents: number, previous: number, simulated = true) {
  return `${title}: $${(cents / 100).toFixed(cents % 100 ? 2 : 0)} round trip${simulated ? " (simulated prices)" : " (live quote)"} — down $${((previous - cents) / 100).toFixed((previous - cents) % 100 ? 2 : 0)}`;
}

export function reminderTime(deadline: string, minutesBefore: number, zone: string) {
  const due = Temporal.Instant.from(deadline).subtract({ minutes: minutesBefore });
  const local = due.toZonedDateTimeISO(zone);
  if (local.hour >= 8 && local.hour < 22) return due.toString();
  const date = local.toPlainDate().subtract({ days: local.hour < 8 ? 1 : 0 });
  return date.toZonedDateTime({ timeZone: zone, plainTime: "21:30" }).toInstant().toString();
}
