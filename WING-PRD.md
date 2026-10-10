# WING — Hackathon Product Requirements and Build Plan

Version: 1.0 · October 10, 2026

Repository: https://github.com/prsuyal/WING

Team: 3 builders. Target: approximately 12 hours, with a working core by hour 8 and the remaining time for reliability, landing page, demo, and Devpost. Submission: October 11, 2026 at 10:00 a.m. America/New_York. Hour estimates are planning targets, not assurances about external account provisioning.

## 1. Product

WING is a casual travel companion in iMessage. It remembers travel preferences, understands schedules, helps friends coordinate trips, searches actual flights, and suggests useful opportunities at appropriate times. People decide where to go and approve actions; WING handles context, search, and coordination.

Both personal travel and group travel are core. They use the same trip engine. The product should solve two problems: finding travel that fits a person's life and turning a scattered group conversation into an agreed plan.

Day-one purchase behavior: search real flights and provide purchase links. Also provide a clearly labeled simulated checkout for the hackathon. No real ticket issuance, card collection, or automated purchase.

### Success criteria

- An actual iMessage DM and an actual group chat can interact with WING through Photon Spectrum.
- A user's DM preferences apply to the correct group trip without exposing private messages.
- Google Calendar and private iCloud calendar connections can inform availability; text, schedule screenshots, and academic calendar links also work.
- WING searches real flights, displays defensible prices and complete itineraries, and returns real purchase options.
- Demo checkout requires explicit confirmation and returns a clearly simulated receipt.
- An opt-in scheduled check can send a useful recommendation without a new inbound message.
- Memory persists across restart. A Supermemory recall example demonstrates a useful conversational preference beyond structured fields.
- A changed date, ambiguous reference, API failure, and duplicate message are handled gracefully.

## 2. Scope and boundaries

### Required for day one

DM onboarding; group trip activation; sender identity across chats; structured trip state; Supermemory; Google Calendar; iCloud calendar integration; text/image/link schedule intake; flight search and booking links; demo checkout; itinerary calendar creation with confirmation; opt-in watches; stop/mute behavior; hosted persistent agent; simple landing page and demo.

### Initial limits

One active trip per chat; adults only; economy cabin; one-way and round-trip flights; one shared origin per group search. Different origins are recognized and WING asks whether to search separately. Support a small demo cohort, with a configurable maximum of 6 travelers per group trip. Search a bounded set of dates, not every airport/date combination. No passport or date-of-birth collection is needed for the simulated purchase.

### Future scope

Live airline booking; Apple Pay/Wallet; Uber/Lyft; automatic airline check-in; cancellations/refunds; split payment; multi-city itineraries; multi-origin coordinated arrivals; automatic creation of family chats; broad destination exploration. Day one can suggest sharing an itinerary with family, but does not create or message a new chat without explicit consent.

## 3. Product behavior

### Voice and onboarding

Short, friendly texts with restrained lowercase styling. Avoid forced slang. Show exact dates, airports, time zones, currency, and prices clearly. Prefer one concise clarification over a questionnaire. During slow tools, send one useful acknowledgment and typing feedback, not repeated updates.

DM onboarding gathers name, time zone, usual departure airport, optional home/destination interests, usual budget and whether it is per-person round trip, nonstop/time preferences, and recommendation opt-in. Calendar connection is offered through a private link. Missing optional details do not prevent use.

Notifications are off until opted in. Default quiet hours: 10 p.m.–8 a.m. in the recipient's confirmed time zone. Default ceiling: one proactive message per recipient/chat per 24 hours. User can change these, pause a watch, or say stop. Explicitly requested responses are not proactive notifications.

### Personal travel

Example: "i've got a four day weekend next month, wanna go home."

Resolve the dates, origin, and meaning of home from known context, asking for missing details. "In March" lacks an exact date range and possibly a year; never silently pick dates for purchase. Save tentative windows and confirm exact dates before searches requiring them. A free calendar does not prove personal availability.

### Group travel

On joining, announce that WING can help plan and remember travel details. Require a participant to activate planning, such as "wing help us plan spring break." Use messages delivered to the agent after activation; do not assume access to earlier group history. Store relevant planning context but remain quiet during unrelated conversation.

Respond when addressed, when one necessary clarification unlocks progress, when asked for a summary/search, or when an opted-in watch produces an actionable result. Debounce short bursts of messages so WING responds to the conversation rather than every bubble.

Each sender owns their own preferences and participation. One member cannot confirm for everyone. A group consensus/date proposal is distinct from each traveler's approval. Exclude a participant from searches only after their own explicit withdrawal or an authorized trip edit, not an inferred absence.

### Schedule intake

Every input produces common records: owner, start/end, source, source reference, time zone, busy/free meaning, recurrence if any, and tentative/confirmed status.

- Google/iCloud: read selected calendars; expand recurring events within a bounded horizon and normalize all-day events and local times.
- Text: interpret phrases such as "four day weekend," "March trip," or "can't leave before Friday at 5." Clarify missing dates/year/time zone.
- Screenshot: download a permitted Photon image attachment, send it to the vision-capable model, extract a candidate weekly schedule, and present a short confirmation. Ask which week/semester and time zone it represents. Do not treat illegible cells or blank spaces as confirmed availability.
- Academic link: extract break dates with source attribution. Prefer ordinary fetch/parsing; use Browser Use for pages that require browser rendering. Support PDFs through a bounded extraction path if needed. School breaks are opportunities, not personal free-time guarantees.
- Contradictions: distinguish busy events from user-declared travel availability. If they conflict, ask whether the event can be skipped; do not silently erase it.

Read schedule sources on connection and when planning. Cache with timestamps; refresh before final itinerary confirmation and during due watches. Use a 90-day default horizon, extending to an explicit requested trip window. Periodic refresh is day-one sync; push subscriptions are unnecessary.

## 4. Memory and cross-chat context

### Responsibilities

Supabase is authoritative for exact current state: identities, memberships, trip dates, constraints, schedule windows, selected itineraries, permissions, watches, and confirmations. Supermemory recalls conversational details and maintains scoped profiles. Claude reasons using both and calls validated tools. Claude API calls alone do not persist memory.

Store inbound/outbound messages automatically. Let the model propose profile/trip updates through narrow tools. Persist validated changes with the source message and time. Send permitted conversational content to Supermemory asynchronously after persistence. Exclude credentials, payment data, raw calendar credentials, and irrelevant attachments. Do not ingest an entire calendar by default; use selected travel-relevant facts.

Use separate Supermemory containers for each user's private memories and each trip's shared memories. Keep private trip associations in metadata inside the private container. Backend selects allowed containers; the model cannot choose arbitrary containers. Verify the installed SDK's current tagging semantics and API signatures before implementation.

### Context routing

1. Resolve provider sender to a stable user and provider space to a chat.
2. Resolve an explicit trip reference, linked DM trip, or the chat's active trip. If multiple trips fit, ask.
3. Load current structured state and authorized recent messages/summary.
4. Retrieve a small set of relevant Supermemory results with source references.
5. Supply the context needed for the current task. Prefer explicit current facts over older or inferred memories.
6. Validate and persist requested updates, then index relevant memory asynchronously.

DM context may include the sender's private memories and shared context from trips they belong to. A group-facing response must not receive raw member DMs or private user profiles. Search/filtering can enforce private constraints through backend code, returning permitted itinerary results rather than private reasons.

Example: Alex DMs "keep my Bahamas flight under $350." Save a private per-person trip constraint. Group searches honor it. If that makes shared options impossible, ask Alex privately about relaxing/sharing the constraint; do not announce the hidden budget. Do not claim agreement or a group budget that the members never stated.

A trip-specific preference overrides that person's general preference. Tentative language remains tentative. Never infer that a casual comment authorizes booking or calendar writes. Summaries are conversational aids, not the sole record of dates, budgets, or approvals.

Immediate follow-ups read newly saved Supabase facts/recent messages even if Supermemory indexing is unfinished. On Supermemory failure, continue with structured context, mark recall degraded, and retry ingestion. Corrections update/supersede relevant memories; deletion removes the scoped records and their Supermemory documents. A memory search must never bypass membership/visibility checks.

## 5. Flight search and purchase flow

Use SerpApi's Google Flights results and booking-options endpoint. It is a third-party data service, not an official Google ticketing API. Follow the complete round-trip selection sequence; an outbound flight alone is not a confirmed full itinerary.

Before searching, resolve origin, destination, exact/flexible dates, adult count, budget meaning, currency, and hard constraints. Default economy only when communicated. Limit flexible-window queries (initial cap: 6 candidate date pairs per request). Reuse suitable cached results and store the retrieval timestamp; respect account quotas.

Recommend at most 3 itineraries with full outbound/return dates and local times, airports, airline, stops, duration, baggage information when available, and total/per-person price clearly distinguished. Missing baggage information is unknown. Explain tradeoffs using permitted facts. Do not fabricate prices, availability, or links.

"Under budget" uses a current returned price. "Price dropped" compares saved observations of comparable itinerary, passenger count, currency, and fare context. "Lower than usual" requires supported price-insight data. Never promise the cheapest fare or a guaranteed price. No results triggers one suggested relaxation, not invented alternatives.

At selection, retrieve current booking options, recheck constraints/availability, and record the selected itinerary version. If prices or dates change, present the change and require a fresh confirmation. A live purchase link means awaiting purchase, not booked. Actual confirmation import is future scope; a user's report can be stored as user-reported without implying provider verification.

### Simulated checkout

BOOKING_MODE defaults to demo. Display "Demo checkout — no payment, no ticket issued" in chat and on the page. Use a short-lived, sender-bound private link. Show selected itinerary, latest quoted price with timestamp, travelers, and optional traveler display names; no card/passport collection.

Every participating traveler approves their own selected itinerary version. Offer a separate demo booking per traveler; combined payment is out of scope. Explicit "confirm demo booking" creates an idempotent local record with a DEMO-prefixed reference. Never call a ticket-issuance/payment endpoint. Duplicate confirmations return the existing result. A changed itinerary invalidates approval.

Return "demo booking complete — no ticket issued." Offer a confirmed calendar action with a [DEMO] event title. Itinerary states: draft → searching → options_ready → selected → awaiting_confirmation → demo_booked, or awaiting_purchase_link in live-link mode. Failed, expired, and cancelled are explicit states. Never equate selecting a flight with booking.

## 6. Calendar connections and output

Use a common calendar adapter: connect, list calendars, read events for a window, create event, disconnect. Normalize events for availability without exposing private titles to groups.

### Google Calendar

OAuth web callback with state protection, refresh tokens, selected calendars, and a chosen writable output calendar. Register demo accounts as test users where required. Request the least permissions that support selected-event reading and confirmed event creation. Store tokens encrypted server-side; never put them in chat or model context. Check whether the chosen account's organization restricts consent.

### iCloud

Implement private CalDAV access, evaluating a maintained client such as tsdav. Verify calendar discovery/read/write against a real demo account immediately; library availability does not establish successful iCloud integration. Collect Apple Account identifier and an app-specific password on a secure private web form, not through iMessage. Require the account owner to generate the password; never request their primary password or two-factor code. Encrypt the credential and support disconnect/revocation errors.

Read-only public webcal/ICS links are an optional fallback. Explain that such links are publicly accessible; never require users to publish a private calendar as the default connection method. Public feeds cannot support writes. ICS export is a fallback for output and must not be presented as completed private sync.

### Event creation

Ask before creating an itinerary event, show destination/date/calendar, and deduplicate by booking+traveler+calendar. Preserve flight time zones. Demo events are visibly labeled. Suggested trips use tentative titles, not "confirmed flight." Never modify/delete unrelated events. Add a calendar reminder where supported; promise no airline check-in capability. Repeated retries create at most one event. Partial success is reported accurately.

## 7. Architecture and data contracts

TypeScript + npm, supported Node LTS, Photon Spectrum, Vercel AI SDK with Anthropic provider, a configurable vision/tool-capable Sonnet model, Supabase Postgres, Supermemory TypeScript SDK, Zod, SerpApi, Google Calendar API, and an iCloud CalDAV adapter. Browser Use is optional for academic-page extraction only. Pin versions through package-lock.json; inspect current provider APIs before coding.

Use one persistent Node service with Photon consumption, HTTP routes for connections/checkout, and a database-backed job poller. Start locally; deploy to Railway as a recommended default if available, or another persistent Node host. Do not assume a request-only serverless deployment can keep a Spectrum consumer running. A separate static landing page is optional; avoid a large frontend framework solely for two forms.

### Minimal tables (can combine where clearer)

| Record | Essential fields |
|---|---|
| users / identities | user_id, provider handle, confirmed time zone, profile, notification preferences |
| chats / memberships | provider space ID, DM/group, members, planning activation, active trip |
| messages | provider message ID (unique), sender, chat, content/attachment reference, timestamp, processing status |
| trips / participants | chat, destination, dates, origin, status, version; each participant's state |
| constraints | owner, optional trip, key/value, visibility, tentative/confirmed, source, updated_at |
| schedule_windows | owner, interval/recurrence, busy/free, time zone, source, confirmation |
| calendar_connections | owner, provider, encrypted credentials, selected calendars, last sync/error |
| flight_searches / selections | query, retrieval time, itinerary, price/currency/count, source token, selection version |
| actions / demo_bookings | owner/trip, kind, version, confirmation, idempotency key, status, result |
| watches / jobs / outbox | target, criteria, due time, attempts, claimed state, cooldown, result |
| memory_documents | source message, permitted container, Supermemory ID, ingest/supersession status |

Backend enforces identity, membership, visibility, and authorization before every tool. Service database keys stay server-side; direct browser database access must have appropriate row-level policies. Source URLs/files are untrusted data, never agent instructions. Bound fetch size/time/redirects and reject local/private network targets for user-supplied URLs.

### Tool contracts

Expose narrow validated operations: update_profile, create_or_update_trip, update_trip_preferences, record_schedule_candidate, confirm_schedule, get_availability, search_flights, get_booking_options, select_itinerary, issue_private_connection_link, create_demo_booking, create_calendar_event, create_or_pause_watch, and search_permitted_memories.

Backend supplies authenticated sender, allowed trip IDs, visibility, and allowed calendars. The model supplies only permitted task arguments. Tool results return structured status, data, and recoverable error codes. Model tool steps are bounded (initial maximum 6 per turn). Approval-dependent tools check persisted explicit confirmation for the current action/version.

Store each inbound event once. Process shared-trip mutations serially or with version checks across DM/group paths. A chat-only lock is insufficient for a DM modifying its linked group trip. Queue messages while one update runs, reload state, and reject stale approvals. Use durable job claims and action IDs. Provider delivery may still be uncertain after a timeout; reconcile where possible rather than claiming exactly-once external delivery.

Use bounded context: approximately 20 recent messages, a short older summary, exact trip facts, and top 5 relevant memories as initial defaults. Track latency, API failures, tool calls, and costs without logging secrets or private text publicly.

## 8. Proactive recommendations

Watches can target an explicit route/trip budget or a person's confirmed travel window plus preferred destinations. Proactive messages require both notification permission and a useful trigger. No permission means no watch messages. Group watches require group activation and explicit opt-in to shared alerts.

Initial worker checks due watches every minute; each watch searches at most hourly by default. Budget controls cap total searches daily. Scheduling and notification caps are configurable. Send on first qualifying offer or a meaningful comparable price improvement (initial threshold: at least 10%); apply the cooldown and suppress unchanged results.

Refresh availability before sending. Expired windows, withdrawn participants, revoked calendars, and paused watches are handled explicitly. Calendar disconnection means availability is unknown, not free. Provide a private team-only "run due check now" demo control that executes the same pipeline. Respect opt-in and cooldown; explain in the demo that the scheduled check was triggered manually for time compression.

## 9. Layered implementation

For each layer: implement its scope, verify acceptance, document the checkpoint, then continue. Do not leave core flows as stubs while starting polish. Workstreams may proceed concurrently once their shared contracts are agreed; no autonomous subagent delegation is requested by this document.

### Layer 0 — Scaffold and first text (target first 30 minutes)

Use the supplied command in the intended project parent directory:

```sh
npm create spectrum-project@latest wing -- --projectId f16aa385-2d69-411f-a2fe-7bfb7cb7eb55 --providers imessage --yes
```

Inspect generated runtime/scripts instead of assuming filenames. The scaffold may provision .env credentials: keep .env ignored, never print/commit its contents, and create a redacted .env.example. In an existing repository, scaffold in a temporary sibling and integrate deliberately to avoid an unintended nested repo/project.

Acceptance: text the assigned Photon number and receive a deterministic reply; add the agent to a group, receive an event, and verify stable sender/chat identifiers. Send an image and verify attachment access. Establish these facts before writing an elaborate agent.

### Layer 1 — Agent and durable conversation (hours 0.5–1.5)

Add model provider, voice, normalized messages, database persistence, deduplication, and bounded recent history. Ask and remember origin/name/time zone. Keep model config in environment.

Acceptance: conversation continues after restart; duplicate provider event is processed once; model outage yields a concise retry response; DM and group identities map consistently. Core pipeline runs even if other integrations are not configured yet.

### Layer 2 — Structured memory + Supermemory (hours 1.5–3)

Implement validated updates, scoped containers, ingestion/retrieval, trip linking, privacy rules, and immediate-state fallback. Persist source references and tentative status.

Acceptance: "no 6am flights" is recalled after indexing/restart without exact keyword matching; a DM budget applies to its group trip; another user cannot retrieve it; group reply does not reveal it; a new explicit preference supersedes an old one; ambiguous trip reference prompts clarification.

### Layer 3 — Schedule understanding and both calendar connections (parallel, hours 0.5–4)

Build secure connection pages, Google OAuth, private iCloud CalDAV, normalizer, text extraction, screenshot interpretation, and academic-link extraction. Refresh and handle recurrence/time zones. Browser Use only if needed for the selected academic page.

Acceptance: two real accounts/providers connect and read a known event; recurring classes block the right times; text input and a screenshot become confirmed schedule records; vague March/week references get clarification; revoked credentials are recoverable. Public ICS fallback is identified as read-only. Confirm an event write on each writable provider during Layer 6.

### Layer 4 — Shared planning and private constraints (hours 3–4.5)

Activate a group trip; extract per-person constraints; allow DM updates; handle message bursts/conflicts and explicit participation. Keep group-facing context separate from private filtering.

Acceptance: three members agree dates; one privately limits price; agent uses the constraint without exposing it; one member cannot approve for another; unrelated group messages do not trigger replies. Conflicting DM/group edits resolve against current trip version.

### Layer 5 — Actual flight search and purchase links (hours 4–6)

Connect SerpApi, map complete itineraries, bound flexible search, rank/filter, retrieve booking options, and persist observations.

Acceptance: actual one-way and round-trip searches return interpretable choices and working source-returned links; per-person/total prices are clear; no results, quota errors, price changes, and unknown baggage are honest. Selection reflects private constraints and current availability.

### Layer 6 — Demo checkout and itinerary calendar writes (hours 5.5–7)

Implement private demo page, version-bound approvals, idempotent simulated receipt, calendar confirmation and output for both providers.

Acceptance: no real purchase occurs; every screen/text labels simulation; repeating confirmation creates one booking and one calendar event; another member cannot use the private checkout link; date/price change requires reapproval; [DEMO] events land on Google and iCloud with correct time zones.

### Layer 7 — Proactive checks and persistent deployment (hours 6–8)

Implement opt-in watches, worker claims, cooldown/quiet hours, stop, observability, deployment, and manual due-check control.

Acceptance: a scheduled check sends an actual iMessage with no new inbound message; unchanged results are quiet; stop survives restart; unavailable calendar is not interpreted as free; deployment restarts and resumes jobs without duplicate simulated actions. Finish both end-to-end journeys by hour 8.

### Layer 8 — Submission quality (hours 8–12)

Freeze core interfaces. Fix observed issues, finish minimal landing page, record demo, prepare Devpost, rehearse questions, and confirm the deployed service. Preserve a prerecorded backup. Do not spend the last hours expanding to payments or rides.

Acceptance: a new test user can onboard; two journeys are demonstrated; one context conflict is handled; functionality claims distinguish live search/calendar integration from simulated purchase. Landing page links to a working onboarding path or clearly labeled demo rather than a dead call to action.

## 10. Three-person work split

| Builder | Ownership | Early dependencies |
|---|---|---|
| A | Photon, agent, message persistence, structured memory, Supermemory, group behavior | Sender/chat normalization and shared schemas |
| B | Google/iCloud, secure connection pages, schedule intake, calendar output | User identity, connection-link contract |
| C | SerpApi, itinerary mapping, demo checkout, watch worker, deployment; later landing page | Trip/query schema, action/approval contract |

Agree shared types and table ownership in the first 30 minutes. Integrate at hours 2, 4, 6, and 8. Use separate files/modules and small reviewed commits; coordinate shared schema edits. Account setup happens immediately in parallel with the first text.

## 11. Setup checklist and external dependencies

Human setup: Anthropic API access/billing, SerpApi key/quota, Supermemory key, Supabase project, Google Cloud Calendar API + OAuth client/redirect URI + demo test users, an iCloud demo account with app-specific password, persistent hosting account. Optional Browser Use key if required by page extraction.

Suggested environment names (map to generated Photon scaffold names): ANTHROPIC_API_KEY, ANTHROPIC_MODEL, SERPAPI_API_KEY, SUPERMEMORY_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, PUBLIC_BASE_URL, CREDENTIAL_ENCRYPTION_KEY, BOOKING_MODE=demo, optional BROWSER_USE_API_KEY. End-user calendar credentials live encrypted in the database, not in a shared .env file.

Gate checks: Photon DM/group/image delivery in first 30 minutes; actual iCloud discovery and Google OAuth during the first 2 hours; SerpApi round-trip and booking options before hour 3. External access failures are reported immediately. Keep disconnected-source and fixture modes clearly marked; do not silently downgrade a required integration or claim a mock is live. If a gate threatens the deadline, explicitly report the affected requirement and concrete fallback for a team decision.

## 12. Validation and demo

Focus automated checks on permission boundaries, cross-chat identity/trip resolution, conflicting updates, confirmation/version checks, duplicate actions, date/time normalization, and watch suppression. Use fixtures for provider failures and screenshot extraction. Add live manual evidence for Photon, each calendar provider, Supermemory recall, and SerpApi links; offline checks alone cannot establish integration success.

### Personal journey

User connects a calendar and shares a schedule screenshot or text availability. They mention wanting to go home and a dislike of early flights. After a later turn/restart, WING recalls the preference, finds flights that fit, sends a purchase link, completes a labeled demo booking when asked, and adds a confirmed [DEMO] itinerary event.

### Group journey

Three people plan a trip; WING collects tentative dates and confirms them. One privately sets a budget. WING quietly incorporates it, catches a schedule conflict, and asks a useful clarification. It returns actual options, collects individual demo approvals, and sends the simulated itinerary. An opted-in watch later emits a qualifying recommendation; unchanged checks remain quiet.

Use dates sufficiently in the future for actual flight search. Academic break dates and demo availability must agree with those dates. Seeded prior price observations are labeled fixtures; never present a staged price drop as a live market change.

### Judge-facing positioning

General impact: reduce coordination effort and help students find trips compatible with schedules and budgets. Do not claim measured savings without evidence. Creativity: private-to-group context and schedule-aware proactive assistance. Technical depth: identity, scoped retrieval, structured tool execution, calendar normalization, and versioned approvals. Presentation: demonstrate complete flows, limitations, and expansion path.

Photon vision: people discuss and choose; the agent supplies memory and execution inside the existing conversation. Craft: restrained participation, readable flight details, cohesive connection/checkout pages. Depth: ambiguous dates, private constraints, recurrence, stale prices, and failures. Traction: an actual hosted number with usable calendar connections and real purchase links.

## 13. Instructions for the developing agent

Read this PRD and applicable repository instructions. Inspect the repository and scaffold before edits. Implement one requested layer at a time, keeping earlier acceptance criteria passing. Do not run a purchase, send to unrequested third parties, or change unrelated calendars. Do not invent SDK methods: consult installed types and current official docs. Keep secrets out of output and commits.

At each checkpoint report: working behavior, verification performed, remaining requirement gaps, and next layer. Record checkpoint evidence in a small BUILD_STATUS.md. A fixture/mock should always be identifiable. Account access is a human dependency, not permission to embed credentials in code.

Suggested first development request:

> Implement Layer 0 of WING-PRD.md in the WING repository. Inspect repository instructions, use the supplied npm Spectrum scaffold, preserve generated credentials privately, and verify actual DM, group, and image delivery. Stop at a working first-text checkpoint and report any human account setup needed. Do not implement later layers yet.

## 14. Integration references

Checked October 10, 2026. Recheck SDK details during implementation.

- Photon Spectrum setup: https://github.com/photon-hq/spectrum-ts
- Photon documentation index: https://photon.codes/docs/llms.txt
- SerpApi Google Flights: https://serpapi.com/google-flights-api
- SerpApi booking options (search/redirect, not ticket issuance): https://serpapi.com/google-flights-booking-options
- Claude Messages API context: https://platform.claude.com/docs/en/build-with-claude/working-with-messages
- Supermemory profiles/recall/isolation: https://supermemory.ai/product/
- Supermemory current API reference: https://api.supermemory.ai/reference
- Google Calendar Node setup: https://developers.google.com/workspace/calendar/api/quickstart/nodejs
- Google Calendar permissions: https://developers.google.com/workspace/calendar/api/auth
- Apple app-specific passwords: https://support.apple.com/en-us/102654
- Apple public/private calendar sharing: https://support.apple.com/en-sg/guide/icloud/mm6b1a9479/icloud
- CalDAV client candidate (verify iCloud compatibility): https://github.com/natelindev/tsdav
- Browser Use: https://browser-use.com/developers
- Railway services: https://docs.railway.com/services
