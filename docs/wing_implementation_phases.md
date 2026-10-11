# wing — Implementation Phases

Based on [wing PRD v2.0](wing_prd.md). This plan organizes the approved scope; it does not add the future roadmap features. Product name remains lowercase.

Finish and verify each phase before declaring it complete. Preserve earlier working behavior. Calendar account provisioning begins immediately even though schedule implementation comes later. Hours are not assigned until the team confirms remaining build time and existing work.

## Overview

| Phase | Outcome | Depends on |
|---|---|---|
| 0. Foundation and access | A deployed bot receives real texts/images and stores them | Account setup |
| 1. Onboarding, memory, and trips | wing remembers a student and keeps several trips separate | 0 |
| 2. Schedule understanding | Google, iCloud, text, and screenshots inform availability | 0–1 |
| 3. Flight planning | Real logic chooses suitable flights from fictional inventory | 1–2 |
| 4. Conversational booking | “book this one” creates one approved demo reservation | 3 |
| 5. Airport rides and calendar output | Approved demo ride and real [DEMO] itinerary events | 2, 4 |
| 6. Parents' link and journey tracking | A hosted trip page updates as simulated events occur | 4–5 |
| 7. Price watches and reminders | Due checks work, useful changes surface, stop persists | 3–6 |
| 8. Demo controls and release | The complete journey is reliable and ready for judging | 0–7 |

The first complete core journey is reached at Phase 6. Watches, reminders, and demo readiness remain required work; Phase 6 is not completion of the full PRD.

## Phase 0 — Foundation and integration gates

**Goal:** Establish a real working messaging service before building travel behavior.

Deliverables:

- Inspect the actual repository and Photon scaffold; retain usable existing structure.
- Configure TypeScript/Node, Supabase, Photon, model access, Supermemory, and HTTPS hosting.
- Establish stable sender identity, private user ownership, persisted messages, and inbound event deduplication.
- Run a deterministic first-text reply and receive an image attachment.
- Define shared user/trip/offer/action/status schemas and demo-provider contracts.
- Start Google OAuth setup and iCloud demo account/app-specific password setup immediately.
- Probe proactive Photon sending to an existing opted-in demo user; record supported or unavailable behavior.
- Keep credentials private, configure environment examples without values, and create BUILD_STATUS.md.

**Complete when:** a real iPhone text receives a reply; an image is accessible; messages survive a service restart; another user's records cannot be accessed; deployment and proactive-send evidence are recorded.

**Checkpoint demo:** send “hello” and a photo; inspect saved message evidence without exposing secrets.

## Phase 1 — Onboarding, persistent memory, and multiple trips

**Goal:** wing learns who the student is and resolves “home” without repeatedly asking.

Deliverables:

- Connect the agent to validated profile/trip tools.
- Conversationally collect name, time zone, school/departure airport, home airport, budget meaning, flight preferences, and notification choices.
- Save optional campus/home addresses with consent in private structured records.
- Support profile corrections, tentative facts, trip-specific overrides, and temporary pickup overrides.
- Implement Supermemory ingestion/retrieval with user isolation, source references, indexing retries, and immediate database fallback.
- Create multiple trips; resolve explicit references and active-trip context; clarify ambiguous booking references.
- Add the minimal authenticated fresh-context control and retrieval evidence view needed to verify memory now; polish them in Phase 8.

**Complete when:** saved facts survive restart/context reset; a contextual preference is retrieved from Supermemory after indexing; a correction supersedes the old value; two trips keep their constraints separate; private addresses do not enter Supermemory.

**Checkpoint demo:** establish RDU/EWR/preferences, clear recent context, ask for a trip home, then correct one preference. Do not claim search exists yet.

## Phase 2 — Calendar connections and schedule intake

**Goal:** wing understands the student's commitments and confirmed travel availability.

Deliverables:

- Private owner-authenticated Google OAuth and iCloud CalDAV connection pages, with encrypted credentials.
- Calendar discovery/selection, access checks, refresh timestamps, and disconnection handling.
- Normalize recurring events, exceptions, all-day blocks, time zones, and daylight-saving changes.
- Text availability extraction and screenshot interpretation into candidate schedule records.
- Confirmation flow for screenshot dates/semester/time zone and uncertain text.
- Availability calculation that distinguishes busy events, user-declared availability, and unknown data.
- Hard class constraints by default; trip-specific permission before considering missed commitments.
- Prove approved [DEMO] event creation once on each provider as an integration check. Full itinerary event generation comes in Phase 5.

**Complete when:** both Google and iCloud read a known event and accept an approved demo event; a recurring class blocks the correct time; a screenshot becomes confirmed records; revoked credentials produce unknown availability rather than an empty/free schedule.

**Checkpoint demo:** send a class screenshot, confirm it, and ask which travel windows avoid the saved commitments.

## Phase 3 — Simulated flight inventory and personalized planning

**Goal:** recommendations reflect the student's actual preferences and schedule.

Deliverables:

- Deterministic fictional RDU → EWR inventory with complete round trips, date alternatives, a nearby-airport alternative, layovers, and an intentionally conflicting option.
- Typed/versioned offers with total prices, baggage assumptions, expiry, time zones, and explicit simulation provenance.
- Application-owned filtering/ranking for dates, budget, preferences, airport travel buffers, and usable time at home.
- Bound flexible searches to six date pairs and a small airport set; return at most three options.
- Natural follow-ups such as “return Monday,” “try the other airport,” or “layovers are okay if I save $80.”
- Synthetic price observations and basic low/typical/high comparisons tied to comparable searches/offers.
- Honest no-results response and confirmation before including a permitted class conflict.

**Complete when:** changing schedule, dates, budget, or preferences changes results; the conflicting cheapest option is rejected by default; the model cannot invent inventory/prices; round-trip totals include both legs; fictional price history is labeled.

**Checkpoint demo:** ask to go home, explain why the cheapest flight does not fit, and compare a date change.

## Phase 4 — “Book this one” and demo confirmations

**Goal:** the defining wing interaction completes a persisted simulated reservation.

Deliverables:

- Fictional saved payment label/reference, without collecting real cards.
- Selection/review state containing itinerary, dates, airports, baggage assumptions, total, and simulation notice.
- Approval bound to the correct user, trip, offer version, total, and action ID.
- Conversational approval sufficient after the exact terms were presented; no mandatory checkout click.
- Simulated booking provider, confirmation record, and concise confirmation text.
- Reapproval after offer changes; recovery after failure or uncertain result; duplicate-action reconciliation.

**Complete when:** “book this one” creates one demo reservation; repeating the request creates no second reservation; stale/ambiguous approval is rejected or clarified; provider failure does not claim success.

**Checkpoint demo:** select an option, approve booking, receive confirmation, and repeat the approval safely.

## Phase 5 — Airport ride and real calendar itinerary

**Goal:** wing organizes the journey beyond the flight itself.

Deliverables:

- Offer airport ride assistance after successful flight booking.
- Confirm saved campus address or a one-trip pickup override; resolve correct airport destination.
- Compute planned pickup using explicit simulated driving time and airport buffer.
- Present pickup date/time, route, ride type, simulated fare, and demo payment reference.
- Separate ride approval and idempotent simulated reservation; future reserved rides differ from immediate dispatch.
- Generate flight and pickup calendar events after explicit calendar approval.
- Deduplicate writes on both Google and iCloud, preserve local time zones, and prefix events [DEMO].

**Complete when:** an approved ride is saved once; a temporary address does not replace the general profile; pickup timing is consistent; itinerary writes work on both providers without modifying unrelated events.

**Checkpoint demo:** approve a ride from the saved address, then open a real [DEMO] flight/pickup event in a connected calendar.

## Phase 6 — Parents' trip page and simulated journey tracking

**Goal:** the student can share a real hosted link that stays current.

Deliverables:

- Mobile-friendly React trip page reading a server-generated public summary.
- High-entropy per-trip links, token hashing, expiry, revocation, and read-only viewer access.
- Flight numbers, airport/date/time details, coarse ride pickup context, status timeline, and last-updated timestamp.
- Persistent simulation banner; no private addresses, calendar contents, payment details, or reservation references.
- Simulated flight and ride tracking events with their source and original/revised times.
- Page polling to reflect persisted updates; no rebuild needed.
- Student-confirmed “I'm home” milestone distinct from a simulated flight landing.
- Delay handling that proposes ride/calendar changes without silently changing approved actions.

**Complete when:** a second device opens the link; persisted events update the page; expired/revoked links fail; the viewer cannot edit; private fields are absent; landing does not auto-confirm arrival home.

**Checkpoint demo:** share the link yourself, simulate a delay and landing, then text “I'm home” and show the updated page.

## Phase 7 — Price watches, reminders, and durable jobs

**Goal:** tracking and notifications work over time rather than only inside a conversation.

Deliverables:

- Postgres-backed jobs/outbox with due times, claims, retries, and restart recovery.
- Target-price and comparable-price-drop watches on an unbooked trip.
- Meaningful-change logic, unchanged-result suppression, notification consent, quiet hours, and configured cooldowns.
- “Stop,” “mute this trip,” and on-demand “check my trip.”
- Calendar reminders where supported; automated iMessage sends only if the Phase 0 gate proved access.
- Separate simulated time progression from real calendar timestamps.
- Scenario advancement invokes normal comparison/notification workers, not a scripted canned message.

**Complete when:** a synthetic qualifying change triggers the actual watch logic; unchanged results stay quiet; stop survives restart; failed/restarted jobs do not duplicate actions; unsupported proactive texts are explicitly recorded as unavailable.

**Checkpoint demo:** watch a second unbooked trip, advance a labeled synthetic price drop, run a due check, and show the result through a verified notification or an on-demand reply.

## Phase 8 — Presenter controls, reliability, and release

**Goal:** the whole journey is reviewable, repeatable, and ready for judging.

Deliverables:

- Finish the authenticated demo panel: reset demo scenario, clear recent context, show memory evidence, advance prices/statuses, run due jobs, and inject a recoverable failure.
- Restrict controls to demo accounts; scenario reset must not alter unrelated records/calendar events.
- Verify one complete journey through all preceding phases and a separate price-watch scenario.
- Run focused checks for ownership, trip routing, approval versions, duplicate actions, calendar/time normalization, notification suppression, and link privacy.
- Confirm both calendars and Supermemory with live evidence, not fixtures alone.
- Polish short responses, mobile page layout, simulation labels, acknowledgments during slow work, and error recovery.
- Deploy the final service, rehearse with a real phone and a separate parent-view device, record a backup, and update BUILD_STATUS.md.
- Verify naming: wing in all product copy. Optional landing page must have a working demo/onboarding path.

**Complete when:** the live end-to-end rehearsal passes; each external integration has recorded evidence; all simulated parts are disclosed; remaining access limits are documented; the backup recording is available.

**Final demo:** onboarding/memory → schedule fit → flight comparison → “book it” → ride approval → calendar event → parent link → simulated tracking update.

## Team coordination

| Builder | Primary responsibility |
|---|---|
| A | Messaging/agent foundation, onboarding, memory, trip routing, conversational approval |
| B | Calendar setup, schedule intake, availability, approved calendar writes |
| C | Flight/ride demo providers, public trip page, tracking/jobs, deployment |

All three agree ownership fields, offer/action versions, schedule formats, provider simulation metadata, and public-summary fields in Phase 0. Work may proceed independently behind agreed contracts: B starts account provisioning immediately; C can prepare fictional inventory while A builds memory. Integrate and verify dependencies before declaring a phase complete. This document does not authorize autonomous subagent work.

## Checkpoint reporting

After every phase, record:

1. Working user-visible behavior.
2. Verification performed and evidence location.
3. Remaining requirement/access gaps.
4. Next phase and any blocking dependency.

A failed integration gate is a reported gap, not a completed mocked integration. Preserve the approved simulation boundary: real messaging, memory, schedule/calendar processing, approvals, and sharing; fictional travel services and payment.
