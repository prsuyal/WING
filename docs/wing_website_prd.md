# wing — Website PRD

Version 1.0 · October 10, 2026 · Hackathon release

## 1. Purpose and relationship to the product

Build a bright, friendly, playful website that explains wing, helps a student start an iMessage conversation, and gives their family a readable trip view.

wing is a travel companion for adult out-of-state college students. Its defining journey is **“get me home” → flights that fit → conversational approval → airport ride → shareable trip.**

This document specifies the website experience. [The product PRD](wing_prd.md) remains authoritative for messaging, approvals, calendars, data ownership, and simulated travel services. [The implementation phases](wing_implementation_phases.md) define backend dependencies. This document does not authorize live flight purchases, payments, or ride dispatch.

The visual direction and use of GSAP plus Motion for React are user requirements. The generated mockup is the initial design reference, not a final pixel specification. Dimensions, typography, and animation timing below are proposed implementation defaults.

## 2. Audience and goals

| Audience | Website job |
|---|---|
| Hackathon judge | Understand the idea immediately, see the journey, distinguish the illustrated walkthrough from functioning integrations |
| Student | Understand the value and start talking to wing on their phone |
| Parent or shared-link viewer | See the current journey status and relevant trip details without signing in |

Release goals:

- Explain that wing works through iMessage in the first viewport.
- Demonstrate schedule-aware planning, persistent preferences, airport transportation, and family sharing through one coherent story.
- Provide a verified phone setup path.
- Serve a real trip page that updates from persisted state.
- Preserve the existing illustration palette and character across desktop and mobile.
- Keep the site fast, readable, and navigable with reduced motion enabled.

## 3. Scope and priorities

| Priority | Deliverable |
|---|---|
| Required | Responsive landing page, five-scene walkthrough, FAQ, footer, setup panel/page, contact card, verified Messages handoff |
| Required | Read-only trip page, persisted updates, simulation disclosure, loading/error/expired-link states |
| Required | Accessible keyboard behavior, reduced-motion alternatives, mobile layout, working release links |
| Supporting product requirement | Private Google/iCloud connection pages and authenticated presenter controls; use the shared design system but keep them outside public navigation |
| Optional polish | Additional illustration variants, a short recorded walkthrough, a final home illustration |

Out of scope: native app distribution, App Store badges, web flight checkout, public account dashboard, pricing plans, invented testimonials, real-time student GPS, and a public flight-search tool.

## 4. Design direction and assets

**Visual idea: a playful illustrated journey from campus to home.** The paper plane is an illustration with no face. Its motion provides expression. Clouds and dotted trails connect the story; travel data stays crisp and readable.

Use these existing assets as read-only references:

- [Paper-plane contact artwork](../images/wing_contact.png)
- [Cloud and plane poster](../images/wing_poster.png)
- [Landing mockup](../images/wing_website_mockup.png)
- [Setup mockup](../images/wing_setup_mockup.png)
- [Shared-trip mockup](../images/wing_trip_mockup.png)

### Palette

These are approximate starting tokens based on the artwork, not measured source colors. Tune against the original images during implementation.

| Token | Starting value | Role |
|---|---|---|
| Paper | `#FFF8EB` | Main cream background |
| Navy | `#052D68` | Text, illustration outlines, primary buttons |
| Sky | `#A8D8F5` | Clouds and supporting surfaces |
| Pale sky | `#E7F3FC` | Received messages and quiet highlights |
| Blue | `#168AF0` | Sent messages and active accents |
| Surface | `#FFFDFA` | Conversation and itinerary surfaces |

Preserve the cream/blue/navy scheme. Status meaning must also be communicated through text and icons; do not depend on color alone. Ensure text/background combinations meet contrast requirements.

### Typography and composition

- Start with a rounded sans-serif such as **Nunito Sans**, using heavy weights for the headline and regular/semibold weights for interface text. Confirm the choice against the mockup before locking it.
- Product name is always **wing**. Preserve capitalization of airports, dates, names, and currency.
- Starting desktop headline size: 72–96 px; mobile: 40–48 px. Body: 16–20 px, with comfortable line height.
- Main content width: approximately 1200 px; desktop gutters 32–64 px; mobile gutters 20–24 px.
- Use a consistent spacing scale: 4, 8, 12, 16, 24, 32, 48, 64, 96 px.
- Rounded bubbles and soft panels should reflect their purpose; avoid making every element an identical card.
- Paper texture stays subtle. Keep dense illustration outside reading areas.
- Build a clean responsive layout rather than reproducing the mockup's tilted panel everywhere. Tilt is decorative and may be removed on small screens.

### Reference interpretation

User-supplied inspiration: [Conductor](https://www.conductor.build/), [heyclicky](https://www.heyclicky.com/), [InsForge](https://insforge.dev/), and [Poke](https://poke.com/).

Use them as references for product presentation, expressive objects, clear hierarchy, and approachable messaging. Keep wing's own artwork, content, and palette; do not copy another site's identity or claims.

## 5. Information architecture

| Surface | Proposed route | Access |
|---|---|---|
| Landing | `/` | Public |
| Phone setup | `/setup` | Public |
| Contact card | `/wing.vcf` | Public download |
| Sample trip | `/demo/trip` | Public, fictional sample clearly labeled |
| Shared trip | `/:token` | Active read-only bearer link |
| Calendar connections | Existing owner-authenticated routes | Private |
| Presenter controls | Existing authenticated demo route | Private |

Routes are proposed contracts to reconcile with the actual repository. Public navigation contains wing, How it works, FAQ, and Set up wing. GitHub and Devpost belong in the footer once real URLs are verified.

## 6. Landing page requirements

### Navigation

Small plane and lowercase wordmark at left. How it works and FAQ jump to their sections. Set up wing opens the desktop setup dialog or navigates to the setup page on phone. Mobile uses a compact layout; add a menu only if the links cannot fit.

### Hero

Initial copy:

> home is a text away.
>
> Flights that fit your schedule. Airport rides sorted. Family in the loop.

Primary action: **Set up wing**. Secondary: **See how it works**. Helper text: **Save the contact. Start texting.**

Desktop uses an asymmetric two-column layout: headline and actions at left, Messages preview at right. Mobile stacks the headline, actions, and preview. Clouds frame the edges and bottom. A faceless paper plane follows a short dotted trail near the conversation.

The preview shows “get me home next weekend,” a schedule-aware response, and a fictional flight option. Include a visible **“Demo · simulated flights and rides”** disclosure and identify the landing sequence as an illustrative walkthrough. It must not appear to be the visitor's personal conversation or a live quote.

Keep headline, actions, and initial preview visible without waiting for animation. Exact prices and dates in the mockup are placeholders; implementation uses a coherent fictional scenario.

### Scroll walkthrough

Heading: **One text. The whole trip.**

| Scene | Content | Visual change |
|---|---|---|
| Request | Student asks to go home; wing recalls school/home preferences | Messages enter; plane moves toward conversation |
| Schedule fit | A flight fits around a confirmed class schedule | Small calendar appears with a suitable window highlighted |
| Approval | Student reviews a specific itinerary and says “book this one” | Selected option settles into a demo confirmation |
| Airport ride | wing offers a ride; student separately approves the shown plan | Pickup summary joins the itinerary |
| Family sharing | Student shares a trip link | Trip preview replaces or accompanies the conversation |

Use short captions that explain the benefit of each scene. Do not imply that rides are booked without approval. Confirmation content states that no ticket was issued, no driver dispatched, and no payment taken, as relevant to the action.

Provide **Skip to trip preview** so judges can reach the payoff immediately. The final scene links to the labeled sample trip, not a private student's bearer URL.

### FAQ and closing action

Answer: What is wing? How do I set it up? Do I need to download an app? What is real in this demo? How does wing use my schedule? What can my family see?

Explain that this release starts by contacting wing in Messages, calendar connection is optional during onboarding, and flight/ride/payment services are simulated. Do not claim guaranteed cheapest flights or affiliation with Apple, airlines, or Uber.

Finish with Set up wing and a compact footer containing the logo, verified GitHub/Devpost links, and relevant privacy information. Omit unavailable links rather than using dummy destinations.

## 7. Phone setup

Setup means saving wing as a contact and opening Messages. This depends on a verified supported messaging identifier and the provider's onboarding requirements; a stable number is an assumption to validate, not an established integration fact.

### Desktop

- Set up wing opens an accessible cream-and-blue dialog styled as wing's contact card.
- Show plane avatar, wing name, brief instructions, and a QR code pointing to the canonical HTTPS setup page.
- Provide a visible setup link as an alternative to scanning.
- Close via button or Escape, contain focus within the dialog, and return focus to its trigger.

### Phone

- Show **Save wing to contacts** linking to a valid vCard using the verified identifier and supported avatar format.
- Show **Open Messages** using a platform-tested messaging handoff.
- Suggest the first text **“hey wing”**. Do not rely on prefilled text until verified on target devices.
- Saving the contact is optional. Users can open Messages first.
- The user confirms contact saving and sends the message themselves.
- Offer visible identifier/copy instructions if contact import or Messages handoff is unavailable.
- Do not label the user “connected” based only on a click. Only backend evidence of an inbound message can confirm conversation start.

No primary Apple password, real payment details, or travel preferences are collected by this public setup surface. Conversational onboarding gathers the profile; private authenticated pages handle calendar connections.

If the messaging provider requires an additional onboarding step, include that verified step before the handoff. Until verified, show a truthful setup-unavailable state and retain the illustrative walkthrough.

## 8. Shared trip page

This page is functional and reads persisted trip state. It uses the same brand with quieter illustration and minimal motion.

Above the fold on phone: chosen student display name, trip title, current status, next relevant milestone, arrival estimate when available, and last-updated timestamp. Keep **“Demo · simulated flights and rides”** visible.

Required details:

- Outbound and return airports, synthetic airline label/flight number, dates, local times, and time-zone labels.
- Original and revised times when delayed; status source and update timestamp.
- Airport ride planned pickup time, booking state, simulated ETA/status, and coarse context such as “campus.”
- Timeline that distinguishes planned events, simulated provider events, and student-confirmed milestones.
- “I'm home” only after the student explicitly confirms it. Landing alone does not mark arrival home.

A schematic airport route is allowed; never show a live student location. Do not expose exact addresses, class schedules, calendar contents, preferences, receipts/payment details, credentials, or reservation references. The receipt item from the whiteboard belongs outside this family view.

Viewers cannot book, edit, approve, or confirm arrival. Copying the current link may be supported, but clearly state that anyone with an active link can view the permitted summary. Owner link generation, expiry, revocation, and regeneration remain authenticated product actions.

### Update and failure behavior

- Poll the narrow public-summary endpoint every 15 seconds while visible; refresh when returning to the tab. Treat this interval as a configurable default.
- Update content without rebuilding the page or moving keyboard focus.
- On a transient failure, preserve the last valid summary with its timestamp and a clear stale-data notice; retry with backoff.
- Initial failure shows a retry action. Missing/expired/revoked links show a neutral unavailable-link page with no trip details.
- Absence of a ride shows “Airport ride not arranged,” not an invented reservation.
- A delay never silently alters approved rides or calendar events.

Bearer tokens are high-entropy, hashed server-side, expiring, and revocable. Shared pages and summary responses prevent indexing and caching of private summaries. Avoid third-party analytics and referrer leakage of link tokens. The browser receives only allowlisted public-summary fields.

## 9. Component system

| Component | Required variants/states |
|---|---|
| Brand mark | Wordmark, plane avatar, compact mobile mark |
| Button/link | Primary, secondary, hover, focus, pressed, disabled/loading where relevant |
| Message bubble | Sent, received, explanatory demo message |
| Flight option | Default, selected, demo-confirmed; readable route, dates, times, total |
| Schedule preview | Fictional busy blocks and highlighted feasible window; landing only |
| Ride summary | Not arranged, reserved, matching, arriving, in progress, completed, canceled/failed |
| Status display | Scheduled, delayed, departed, landed, student-confirmed home |
| Journey timeline | Planned, simulated, student-confirmed milestones |
| Setup card/dialog | Desktop QR, phone actions, unavailable/fallback |
| FAQ row | Expanded, collapsed, keyboard focus |
| Demo disclosure | Compact walkthrough label and persistent trip banner |
| Trip states | Loading, empty field, stale, initial error, unavailable link |

Separate display components from data fetching and the scroll controller. Landing previews use fictional fixture data; the functional trip page uses the public summary. Never expose private trip records to a presentation component and rely on hiding them with CSS.

## 10. Motion specification

Use **GSAP + ScrollTrigger** and **Motion for React**, formerly Framer Motion.

| Owner | Responsibilities |
|---|---|
| GSAP | Desktop pinned walkthrough, plane along an SVG route, dotted-trail reveal, restrained cloud parallax, coordinated scene transitions |
| Motion | Message entry at scene checkpoints, component state transitions, FAQ expansion, setup dialog entry/exit, button feedback |

- Do not let both libraries animate the same transform/property on the same element. GSAP can control an outer wrapper while Motion controls its children.
- Use one controlled story sequence. Do not add a reveal effect to every section.
- Scroll controls scene progress; message text appears whole at readable checkpoints rather than being revealed letter by letter.
- Proposed timings: 150–250 ms for controls, 250–400 ms for bubbles, 400–700 ms for scene transitions. Reading pace is determined by scroll distance and tested with users.
- Keep native scrolling; no scroll hijacking or forced snapping.
- Desktop may pin the conversation. Mobile uses stacked scenes with shorter transitions and no prolonged pinning.
- Reduced motion removes path travel, parallax, tilt, and pinned choreography; present all content in a normal readable sequence with direct navigation.
- No perpetual cloud/plane loops. Clean up animation instances on route changes and rebuild correctly after resize.
- Content and actions remain available when animation initialization fails.

Implementation references: [GSAP React integration](https://github.com/greensock/react), [ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger/), [Motion layout animation](https://motion.dev/docs/react-layout-animations), and [Motion reduced-motion configuration](https://motion.dev/docs/react-motion-config). Verify installed versions and current APIs before implementation.

## 11. Technical, accessibility, and performance requirements

- Use Next.js App Router + React + TypeScript in `website/`, alongside the existing persistent messaging backend. This supersedes the earlier Vite requirement per the user’s October 10 decision. Pin dependencies.
- Use SVG for the animation route and vector plane geometry where practical; use optimized raster assets for watercolor texture/clouds. Derive new assets outside `sources/`.
- Load the hero promptly and defer below-fold illustration and optional recordings. Reserve image dimensions to prevent layout shifts.
- Test at 360, 390, 768, 1280, and 1440 px widths; no horizontal overflow or obscured controls.
- Meet WCAG 2.2 AA for contrast and interaction. Provide semantic headings, descriptive buttons, visible focus, keyboard-operable FAQ, dialog focus management, and approximately 44 px touch targets.
- Decorative artwork is hidden from assistive technology. Announce meaningful trip-status changes politely without announcing every poll.
- Target LCP ≤ 2.5 s, CLS ≤ 0.1, and INP ≤ 200 ms under representative mobile conditions. Record lab checks; do not claim field metrics without actual usage data.
- Public landing/setup pages have descriptive titles and social metadata. Private trip pages use generic metadata that does not disclose a student's itinerary.
- No analytics vendor is required for the hackathon. Use manual evidence and minimal operational logs without raw bearer tokens or unnecessary personal data.

## 12. Build order and acceptance criteria

1. Confirm the provider's contact identifier and setup requirements. Agree the public-summary contract with the backend.
2. Build the static desktop/mobile hero and setup experience; review against the artwork and mockup.
3. Build reusable travel components and the functional shared trip page, including privacy and failure states.
4. Assemble the five-scene walkthrough, then apply GSAP and Motion with mobile/reduced-motion alternatives.
5. Connect setup and persisted updates, deploy, and rehearse with a phone and separate viewer device.

| Area | Release evidence |
|---|---|
| Brand | Cream/blue/navy palette, existing illustration character, faceless plane, lowercase wing |
| Landing | First screen explains iMessage travel assistance; all actions and section links work |
| Walkthrough | Five coherent scenes, separate ride approval, visible simulation labels, skip action |
| Setup | QR reaches deployed setup page; vCard and Messages handoff verified on target iPhone; fallback works |
| Trip | A second device reads persisted status; a simulated delay updates within the polling window plus request latency |
| Privacy | Summary contains no forbidden fields; revoked/expired links fail; viewer cannot mutate state |
| Correct status | Landing does not imply home arrival; student confirmation creates the final milestone |
| Resilience | Stale/error/empty states are truthful; route changes and resize do not duplicate animation instances |
| Accessibility | Keyboard, reduced motion, touch targets, contrast, and screen-reader status behavior checked |
| Responsive/performance | Target widths verified, no overflow, optimized assets, lab performance results recorded |

For the judging rehearsal: show the hero → scroll or skip through the story → start a real Messages conversation → complete the backend demo journey → open the actual shared trip page on another device → advance a simulated delay → confirm home via the student conversation. Keep the scripted landing walkthrough distinct from that real integrated demonstration.

## 13. Decisions to verify before release

- Stable wing messaging identifier and any Photon onboarding prerequisites.
- Contact-card/avatar import and Messages link behavior on the actual demo iPhone.
- Final typography, image exports, and composition review against the initial mockup.
- Deployed origin for setup QR codes and share links.
- Backend summary shape, time-zone representation, and source labels.
- Real GitHub and Devpost destinations.
- Actual hackathon submission deadline and remaining build time; do not allocate hours from an unverified earlier estimate.

These are verification tasks, not reasons to block static design work. Report unsupported integration behavior honestly and prioritize the working trip page and phone flow over optional visual effects.

## 14. Phase 1 website implementation

The website runs at `http://localhost:3000`; the messaging backend runs on port 3001. Follow the supplied landing, setup, and shared-trip mockups. Public Photon onboarding is not verified: the only enrolled user is the demo participant. Keep contact-saving and Messages actions unavailable with an explanation until a supported public identifier/onboarding flow is verified.

Minimal sharing is brought forward from phase 6: seven-day, high-entropy, hashed, revocable links generated only for a trusted messaging sender’s own trip. Real pages expose only saved display name, confirmed trip airports/dates, planning status, update timestamp, and simulation flag. Unbuilt flight/ride/tracking functionality stays absent. `/demo/trip` remains a separately labeled fictional sample. Applying the additive sharing migration and configuring bot credentials is required for persisted link testing. Localhost links and QR codes cannot open on a separate device. This does not declare phase 6 complete.
