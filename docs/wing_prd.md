# wing — Product Requirements and Hackathon Build Plan

Version: 2.0 · October 10, 2026

Product name: **wing**, always lowercase in product copy.

This document replaces the earlier product scope for implementation. The original synced PRD remains read-only reference material. Existing repository instructions still apply. Proposed repository: https://github.com/prsuyal/WING; the repository URL does not determine product capitalization.

## 1. Product and audience

wing is a personal travel companion over iMessage for out-of-state college students. It remembers where a student studies and where home is, understands their schedule, finds suitable flights, accepts a conversational booking approval, organizes airport transportation, and creates a trip link the student can share with their parents.

The central interaction is: **“get me home” → suitable itinerary → “book this one” → confirmation → airport ride → shareable trip.**

The hackathon product implements this entire interaction using simulated flights, prices, payments, bookings, rides, and tracking. Memory, messaging, schedule processing, connected calendars, approval handling, saved trip state, and the shareable website must actually work.

Value proposition: students should not repeatedly enter their airport, home destination, class schedule, preferences, and pickup address whenever they want to go home.

Primary user: an adult out-of-state college student. Secondary viewer: a parent or another person who receives the student's trip link. The viewer does not need a wing account and cannot book or edit the trip.

## 2. Product boundaries and demo truth

| Capability | Required implementation |
|---|---|
| iMessage conversation | Real Photon direct messaging and attachment delivery |
| Agent reasoning | Real model calls using validated application tools |
| Personal memory | Real database persistence and Supermemory ingestion/retrieval |
| Google Calendar | Real authorized read and approved event creation |
| iCloud Calendar | Real authorized CalDAV read and approved event creation |
| Schedule screenshots | Real extraction, clarification, confirmation, and persistence |
| Flight search and inventory | Consistent fictional dataset searched by application logic |
| Price history and price changes | Labeled synthetic observations; actual comparison logic |
| Payment | Test-only saved payment reference; no real card collection or charge |
| Flight reservation | Simulated booking with persistent demo confirmation |
| Uber ride | Simulated booking, driver details, fare, and status progression |
| Flight tracking | Simulated events processed by actual application logic |
| Calendar reminders | Real events/reminders where the connected provider supports them |
| Automated iMessage reminders | Required integration gate: verify delivery to an existing opted-in user |
| Parents' trip page | Real hosted page reading persisted trip state |

Display **“Demo · simulated flights and rides”** on the trip page and booking interfaces. Every flight/ride confirmation states that no ticket was issued, no driver dispatched, and no payment taken. Price charts are labeled simulated. A persistent demo label is sufficient for ordinary planning replies; confirmation messages must explicitly identify the simulation.

No group-chat dependency, cold outreach, automatic texting of parents, live ticket issuance, real Uber dispatch, real payment collection, automatic airline check-in, or continuous student GPS tracking is required. Real flight/ride providers are future adapters, not dependencies for this build. SerpApi and Duffel are not required for the simulated version.

## 3. Success criteria

- A student completes the core journey through real iMessage DMs and a working trip page.
- Preferences and private addresses survive service restart and fresh conversation context.
- Google, iCloud, and confirmed screenshots produce usable schedule records.
- Schedule constraints and saved preferences actually change selected flight results.
- Natural follow-ups retain the right trip context; multiple trips remain separate.
- “Book this one” confirms a specific itinerary, current total, and simulated payment reference.
- Repeated messages or retries create one demo reservation and one approved calendar event per target calendar.
- Airport ride planning uses a confirmed pickup address and a consistent travel-time estimate.
- Flight and Uber statuses update the hosted trip page without rebuilding it.
- Synthetic price changes trigger the same watch logic used by scheduled checks.
- No private calendar details, exact pickup addresses, credentials, or booking references leak onto the parents' page.
- A judge can distinguish functioning integrations from simulated external services.

## 4. Onboarding and conversation

Use short, friendly replies with restrained lowercase styling. Preserve readable names, airport codes, flight numbers, dates, times, and currency. Ask one useful question at a time. Offer optional calendar connection after enough context exists to be helpful; do not block onboarding on it.

Collect incrementally:

- Name and confirmed time zone.
- School/campus or school city; preferred departure airport and allowed nearby alternatives.
- Home city and preferred arrival airport; clarify “home” rather than guessing an airport.
- Usual budget and whether it means per-person round-trip airfare or total trip spending.
- Cabin, nonstop/layover preference, baggage needs, earliest/latest acceptable departures.
- Optional campus pickup and home addresses, saved only after the student agrees.
- Calendar/screenshot intake choice and notification preferences.

Defaults: economy when communicated; one traveler; notifications off; no assumption that calendar gaps prove availability. Set these as confirmed defaults before booking.

Avoid recollecting saved facts. “Use your saved campus address?” confirms the pickup without requiring reentry. “Pick me up at the library this time” changes only that ride unless the student explicitly updates their saved address. Confirm exact pickup details privately before ride approval.

Onboarding must never request a primary Apple password or real payment card through Messages. Connection links open private web forms.

## 5. Memory and multiple trips

### Structured state

Supabase is authoritative for exact current values: identities, preferences, addresses, schedule records, permissions, trips, offers, selected itinerary, approved price, bookings, ride plans, watches, share links, and calendar event IDs.

Every extracted update records its source message, timestamp, owner, and tentative/confirmed status. A trip preference overrides the general profile for that trip. Explicit corrections supersede older values. “Maybe” does not become a confirmed decision.

### Conversational recall

Supermemory stores permitted travel-relevant conversation and supports recall of contextual preferences such as “I like arriving before dinner with my family.” Use user-scoped memory and trip metadata/namespaces supported by the installed SDK. Backend code selects authorized scopes; the model cannot choose arbitrary users' memories.

Persist structured facts and messages before asynchronous indexing. Immediate follow-ups use the newly saved database state. On Supermemory failure, retain structured functionality, mark contextual recall degraded, and retry ingestion. Never claim Supermemory recall when the result came solely from another source.

Do not send credentials, payment data, exact street addresses, raw calendars, or irrelevant attachments to Supermemory. Store private addresses in structured records. Retrieve only travel-relevant schedule constraints for the model.

### Trip routing

Support several planned/booked trips for one student. Each trip has its own ID, purpose, dates, constraints, offers, approvals, reservations, ride, tracking, and share link. Resolve explicit trip references first, then the active conversational trip. If two trips fit “that flight,” ask before modifying or booking either.

An unrelated trip must not inherit another trip's dates, selected offer, booking reference, or class-skipping permission. General profile preferences can be reused.

### Memory demonstration

An authenticated presenter control clears recent model context and summaries for a dedicated demo session while preserving saved facts and Supermemory. The next request demonstrates actual retrieval. Maintain a private evidence view showing the origin of retrieved context. Context reset must not silently delete the student's trips or calendar connections.

## 6. Schedule understanding and time away

Required inputs: Google Calendar, private iCloud Calendar, text availability, and schedule screenshots. All normalize to owner, start/end, time zone, recurrence, source reference, busy/free meaning, and confirmation status.

Google uses OAuth and appropriately scoped access. iCloud uses a verified CalDAV client with an app-specific password entered through a private form; encrypt credentials at rest. Discover available calendars and allow selection. Confirm read and write permissions rather than assuming both.

For screenshots, extract candidate schedule blocks, ask which week/semester and time zone they represent, and confirm before applying. Illegible cells and blank spaces do not prove availability. Expand recurring records only within the requested planning horizon. Handle all-day events, exceptions, time zones, and daylight-saving changes.

Refresh selected calendar data during planning and before final booking approval. Track freshness and failures. A disconnected calendar means availability is unknown. User-declared constraints can supplement calendar data; resolve contradictions explicitly.

Rank feasible flights by budget, preferences, and usable time at home. Account for reaching the airport before departure and reaching campus/home after arrival using explicit configurable demo estimates. Show price/time tradeoffs and compare a bounded set of flexible date pairs and nearby airports.

Class commitments are hard constraints by default. wing may ask whether a specific conflict is negotiable, but must not assume permission to miss class. Only consider conflict-bearing alternatives after the student permits it for that trip; show exactly which commitment would be affected. Never remove or edit a class event.

## 7. Simulated flights, prices, and booking

### Flight provider

Use a deterministic demo provider with enough fictional inventory to make choices meaningful: RDU → EWR as the primary scenario, a nearby-airport alternative, different departure times/date pairs, nonstop and connection options, and at least one deliberately conflicting flight. All airline identifiers and reservation references are visibly synthetic.

Each offer includes an ID and version, complete outbound/return segments, flight numbers, airports, local times/time zones, currency, per-person and total price, cabin, baggage assumptions, expiry, and simulated provenance. Round-trip totals must cover both directions.

Filters and ranking run in application code. The model cannot invent an offer, price, or successful booking. Initial comparison limits: up to six date pairs and a small configured airport set per request. Return at most three explained options.

### Price context and watches

Maintain timestamped synthetic price history tied to a defined search or comparable itinerary. Explain low/typical/high relative to that dataset. Do not promise the best possible future price or guaranteed savings. Track selected offers separately from search-level cheapest prices so a different itinerary is not presented as the same flight becoming cheaper.

Student can set a target price or meaningful-drop watch. Demo default: notify on first price at/below the target or at least a 10% comparable drop since the last notified observation. Suppress unchanged results and respect notification settings. Snapshot and reconfirm offer details before booking.

### Saved payment and approval

Use a fictional saved payment label such as **“Demo card ending 4242”** and a test reference only. Explain during setup that it cannot be charged. Do not collect a real card number, CVV, or bank details. Future live payment credentials belong with a qualified provider, not memory.

Before accepting “book it,” show the selected itinerary, dates, airports, baggage assumptions, total currency/price, demo payment label, and simulation notice. Bind approval to trip ID, offer ID/version, price, and action ID. If the offer changes or the reference is ambiguous, require fresh approval. Context can make “book this one” sufficient without adding a separate checkout click.

On success, persist a demo reservation and send the synthetic confirmation, itinerary, and next-step ride question. On failure, report that no reservation was created. Duplicate requests and uncertain retries must reconcile against the saved action before attempting another booking.

## 8. Airport ride assistance and simulated Uber booking

After a flight booking succeeds, ask: **“want me to arrange an Uber to the airport?”** This question does not authorize a ride.

Resolve saved pickup address or a one-trip override; destination is the correct departure airport. Calculate pickup time from departure time minus configurable airport buffer and simulated travel duration. Show assumptions and ask for missing accessibility, luggage, or ride-type requirements when necessary. A schedule conflict in the airport journey is as relevant as one during the flight.

Show pickup, destination, planned pickup date/time/time zone, simulated fare, ride type, and demo payment reference before approval. Persist one simulated ride reservation with its own approval and action ID. Label it **“Demo Uber booking — no driver dispatched or charge made.”**

Distinguish a future reserved ride from an immediate ride request. Simulated progression: reserved → matching → driver assigned → arriving → in progress → completed; support a cancellation/failure scenario. Driver, vehicle, plate, ETA, and map coordinates are fictional and labeled. Never imply affiliation or real Uber account access.

No real Uber API or deep link is necessary for this build. Keep a provider interface so a supported live integration can replace the simulation later. No returning-home ride is auto-created without another explicit approval.

## 9. Calendar output, reminders, and tracking

After booking, offer to add flight and airport pickup events. Confirm the selected calendar, dates, and times. Write real **[DEMO]** events to approved Google/iCloud calendars. Use stable event identifiers and deduplication; never change unrelated events. Request confirmation before moving an existing wing event after itinerary changes.

Support both price monitoring and journey tracking. A flight event includes original scheduled time, estimated/revised time, status, source, and last update. Simulated journey progression includes scheduled, delayed, departed, and landed. A landing does not prove the student arrived home. “I'm home” can create a student-confirmed final milestone.

A delay updates tracking, but does not automatically change a ride reservation or charge anything. Propose changes and require approval.

Use database-backed jobs for due price checks, flight updates, and reminders. Opt-in per user/watch; default quiet hours 10 p.m.–8 a.m. in the confirmed local time zone and a configurable ceiling of one proactive message per 24 hours. “Stop” and “mute this trip” persist across restarts. Requested replies are not proactive messages.

Verify proactive Photon delivery to an onboarded user as an early gate. If unavailable, retain calendar reminders, hosted tracking updates, and on-demand “check my trip” responses. Report automatic text reminders as unavailable rather than silently claiming delivery. Backend scheduling must still work.

## 10. Parents' trip link

Create a mobile-friendly trip page with a persistent simulation banner. The student chooses to generate/share the link and copies it into their own message to parents. wing does not text the parents.

Required content:

- Student's chosen display name and trip title.
- Departure/arrival airports, airline label, flight number, outbound/return dates and local times.
- Simulated flight status, revised times, source, and last-updated timestamp.
- Airport ride's planned time, booking state, and simulated ETA/status; show coarse pickup context such as “campus,” not a street address.
- A journey timeline that separates planned, provider-simulated, and student-confirmed milestones.
- Clearly labeled **“I'm home”** milestone only after the student's confirmation.

Do not expose calendar events, class schedule, private preferences, payment details, exact pickup/home addresses, calendar credentials, or airline/demo reservation references. Do not publish precise student GPS location. A schematic route may use public airport coordinates, but is not a live student map.

Use high-entropy, per-trip bearer links with server-side revocation, expiry, and read-only access. Store token hashes, avoid private data in URLs, prevent indexing, and avoid third-party analytics that leak link tokens. Anyone holding an active link may view permitted content; explain this when generating it. Regeneration revokes the previous link. Owner actions use separate authentication, not the parent's token.

The page polls a narrow public-summary endpoint and displays saved updates without a deployment. Do not expose database service credentials or unrestricted trip APIs to the browser.

## 11. Technical architecture

| Layer | Choice |
|---|---|
| Language/runtime | TypeScript, npm, supported Node LTS; pinned dependencies |
| Messaging | Photon Spectrum iMessage provider |
| Agent | Vercel AI SDK with Anthropic provider; configurable vision/tool-capable Claude model |
| Validation | Zod schemas and server-side ownership/approval checks |
| HTTP service | Fastify, or existing scaffold HTTP framework if adequate |
| Persistence | Supabase Postgres and private object storage when attachments must persist |
| Recall | Supermemory TypeScript SDK; verify current namespace and profile contracts |
| Calendars | Google Calendar API/OAuth; verified CalDAV client for iCloud |
| Travel | Local demo flight, payment, Uber, and tracking providers |
| Web | Next.js + React + TypeScript; connection forms, trip page, and private presenter panel (supersedes Vite per the user’s October 10 website decision) |
| Jobs | Postgres-backed job/outbox polling in the persistent service |
| Hosting | Railway or equivalent persistent Node hosting; serve built web assets from the same service |

Keep one persistent service for Photon consumption, HTTP endpoints, agent execution, and job polling. Avoid a request-only deployment that cannot sustain messaging/background work. Prefer the existing scaffold structure rather than unnecessary framework migrations.

Tool interfaces include update_profile, save_schedule_candidate, confirm_schedule, retrieve_memory, create_trip, update_trip_constraints, get_availability, search_flights, compare_prices, select_offer, book_demo_flight, plan_airport_ride, book_demo_ride, add_calendar_events, create_watch, pause_watch, get_trip_status, generate_share_link, revoke_share_link, and confirm_arrival_home.

The authenticated sender is supplied by backend code, never trusted from model arguments. Bound tool steps, message context, and retrieval size. Serialize mutations per trip with version checks. Deduplicate inbound provider events, approval actions, outbound effects, and calendar writes. Retry transient failures without repeating side effects.

Suggested tables: users, identities, preferences/addresses, messages, trips, schedule_windows, calendar_connections, offers, price_observations, booking_actions, demo_bookings, rides, tracking_events, calendar_events, watches, jobs/outbox, share_links, and memory_documents. Related tables may be combined if ownership, constraints, and traceability remain clear.

Provider interfaces return typed data with explicit simulation metadata. Demo scenario advancement changes data and invokes normal workers; it must not bypass approval, notification, or booking logic. Separate the demo clock from real calendar timestamps.

## 12. Build sequence and integration gates

Retain the three-person team assumption from the original plan. Deadline in the prior reference: October 11, 2026 at 10 a.m. America/New_York; verify remaining time before assigning hour estimates. Do not assume all integrations can be provisioned on schedule.

1. **Messaging and identity:** inspect repository/scaffold; prove DM, image delivery, persistence, restart, and sender ownership. Probe proactive send rules.
2. **Memory and trip state:** structured profile, Supermemory recall, corrections, multiple-trip routing, fresh-context demo control.
3. **Calendar and schedule intake:** begin Google/iCloud account setup immediately; normalize text/screenshots; prove read and approved write on both providers.
4. **Flight simulation and planning:** coherent fixture inventory, flexible dates/airports, schedule filtering, price context, selection, and version-bound booking.
5. **Ride and itinerary:** confirmed address reuse, pickup calculation, simulated ride booking, and calendar entries.
6. **Trip link and tracking:** protected public summary, revocation, polling, simulated journey events, and arrival confirmation.
7. **Jobs and demo reliability:** watches, notification gates, authenticated scenario controls, recovery, rehearsals, and backup recording.

Work split: A owns Photon, agent, memory, trip routing; B owns Google/iCloud, schedule extraction, calendar writes; C owns demo travel providers, ride/tracking jobs, trip page, deployment. Agree schemas and action contracts first. This plan does not request autonomous subagents.

External setup: Photon Pro project/onboarding path, Anthropic key/billing, Supermemory key, Supabase project, Google OAuth app and demo test users, iCloud demo account with two-factor authentication/app-specific password, hosting, and public HTTPS callbacks. No real booking, flight-data, payment, Uber, or tracking API key is required.

## 13. Live judging script and presenter tools

Use dedicated demo accounts and fictional travel records. Choose explicit future dates consistent with the demo class schedule; do not present seeded classes as a real university's official calendar.

1. Student texts name, RDU departure, home near EWR, budget, and a conversational preference. Show persistence evidence privately.
2. Send a schedule screenshot and confirm the extraction; show a connected calendar constraint.
3. Clear recent agent context while retaining database and Supermemory. Ask to go home for explicit dates. Show recall and personalized search.
4. Compare fictional options: cheapest conflicts with class or airport travel, another fits. Show synthetic price history with explicit labeling.
5. Student changes dates/preferences. Search changes accordingly.
6. Student approves an exact option: “book this one.” A demo reservation appears; repeat the request to demonstrate no duplicate purchase.
7. Student approves the airport ride using a saved address. Show simulated ride reservation.
8. Approve a real [DEMO] calendar event and open it in a connected calendar. Maintain separate evidence that both Google and iCloud were verified.
9. Generate the real parents' link and open it in a separate browser/device.
10. Advance a simulated delay/ride/landing event. The same hosted page updates. Student texts “I'm home” to confirm final arrival.

Authenticated presenter controls: reset scenario, clear model context, advance price observation, run due checks, advance flight/ride event, and inject a recoverable provider failure. Price-drop notification scenarios should use an unbooked second trip, not imply a watch would repurchase the already booked flight.

Controls operate only on demo users/trips. Reset must not delete unrelated external calendar events. Keep a pre-recorded end-to-end backup, but identify when showing a recording.

Judge-facing statement: **“wing's messaging, memory, schedules, calendar actions, and trip-sharing flow work. Flights, payments, Uber bookings, price history, and tracking are simulated for this demonstration.”**

## 14. Acceptance and reliability checks

| Area | Required evidence |
|---|---|
| Memory | Fresh context retrieves saved facts and a contextual preference; correction wins; another user cannot retrieve it |
| Multiple trips | Ambiguous request asks; explicit trip edit leaves the other trip unchanged |
| Schedules | Real Google/iCloud read/write; screenshot confirmation; recurring/time-zone conflict; revoked calendar becomes unknown |
| Planning | Changing dates/budget/airport/class permission changes results; no valid option yields an honest explanation |
| Booking | Changed offer requires reapproval; duplicate approval produces one reservation; failure does not claim success |
| Uber | Saved address confirmed; temporary override stays temporary; independent ride approval; consistent pickup timing |
| Calendar | Repeated action creates one event; [DEMO] label and correct time zones; unrelated events untouched |
| Watches | Meaningful synthetic change qualifies; unchanged result is quiet; stop survives restart; delivery status is honest |
| Trip page | Updates persisted statuses; omits private fields; revoked/expired link fails; bearer viewer cannot mutate |
| Recovery | Model/memory/calendar/provider failures are recoverable; worker restart resumes without duplicate actions |

Use focused automated tests for authorization, routing, versions/approvals, deduplication, schedule normalization, watch suppression, and public-summary privacy. Use live manual evidence for Photon, both calendars, Supermemory, and deployed web access. Record checkpoints and remaining gaps in BUILD_STATUS.md.

## 15. Integration references and implementation instructions

References checked October 10, 2026; inspect installed SDK types and current documentation before coding. Do not invent methods or assume account access from documentation alone.

- [Photon plan comparison](https://photon.codes/pricing): Pro has a user cap/shared numbers; full groups and cold outreach are not core dependencies here.
- [Photon Spectrum TypeScript](https://github.com/photon-hq/spectrum-ts)
- [Supermemory overview](https://supermemory.ai/docs/overview/what-is-supermemory)
- [Google Calendar Node quickstart](https://developers.google.com/workspace/calendar/api/quickstart/nodejs)
- [Google Calendar scopes](https://developers.google.com/workspace/calendar/api/auth)
- [Apple app-specific passwords](https://support.apple.com/en-us/102654)
- [CalDAV client candidate](https://github.com/natelindev/tsdav): verify iCloud behavior before selection.

Before edits, inspect the actual repository and instructions. Preserve secrets privately; never print or commit them. Do not edit synced sources. Build one complete vertical journey before optional polish. The landing page, if added, must use the name wing and explain the demo status.

Do not create real purchases, request real rides, send unrequested third-party messages, or modify unrelated calendars. Keep hypothetical future capabilities separate from what was demonstrated. Report working behavior, verification, gaps, and the next checkpoint at each layer.
