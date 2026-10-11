# Website verification — October 10, 2026

Branch: `codex/website`. Next.js App Router site in `website/`.
Website origin: `http://localhost:3000`; bot HTTP origin: port 3001.

## Automated checks

- Backend TypeScript check passes.
- Website TypeScript check passes.
- Next.js optimized production build passes; landing, setup, and sample trip
  are static, private trip and summary proxy are dynamic.
- 45 tests pass, including the existing phase 1 tests, sender ownership,
  sharing consent, token hashing, expiry/revocation query filters, allowed
  summary fields, read-only HTTP access, and website proxy failure behavior.
- Private summary responses reject additional fields rather than forwarding
  unexpected private data. Invalid short tokens fail without a backend call.
- Browser console has no application errors on the landing, setup, and sample
  trip pages during QA.

## Browser verification

Inspected the local app with the Codex in-app browser:

- Landing, setup, and sample trip are responsive at 360, 390, 768, 1280, and
  1440 px. Document width equals viewport width after fixing tablet cloud
  overflow. Desktop and mobile screenshots were inspected.
- Setup on mobile opens `/setup`. Public contact/Message actions are disabled
  and explain demo-only access. The enrolled participant can use their existing
  conversation; no phone number or fabricated contact is exposed.
- Desktop setup opens a native modal dialog. Keyboard activation, Tab focus
  containment, Escape close, and focus return to the trigger were verified.
- Sample trip is visibly fictional, distinguishes revised flight times and
  planned milestones, and does not mark landing as home confirmation.
- Real private pages have generic metadata and `noindex, nofollow, nocache`.
  HTTP checks confirmed `Cache-Control: no-store` and `Referrer-Policy:
  no-referrer`; summary APIs additionally send `X-Robots-Tag`.

## Backend integration QA

A temporary localhost fixture exercised the **actual** backend HTTP server
and Next.js proxy, reading fictional state from a temporary JSON file. It was
stopped after verification and never used real user records:

1. Private page loaded a planning summary with RDU/EWR and confirmed dates.
2. Changing the persisted fixture to JFK updated the page through polling,
   without navigation or a rebuild.
3. A backend outage preserved the previous summary and displayed a stale-data
   notice with a retry action.
4. A revoked/missing link cleared the previous name and airports and displayed
   the unavailable-link view.
5. API checks confirmed missing tokens return 404 and temporary outages return
   503 with a generic response.

## Remaining live verification

Root `.env` is absent in this checkout. No hosted Supabase migration was
applied and no Photon messages were sent. Apply the additive trip-link
migration and configure the bot environment as documented in `README.md` to
test real persisted links with the enrolled participant.

Public Photon onboarding, vCard import, and Messages handoff are intentionally
unavailable until a verified public setup flow exists. Localhost QR/link tests
on a separate phone need a reachable HTTPS origin later.

Reduced-motion CSS and GSAP match-media cleanup were reviewed. An OS-level
reduced-motion setting was not emulated. LCP/CLS/INP under representative
mobile throttling were not measured; no performance or full WCAG certification
is claimed. Basic text contrast was checked: white/darkened sent-message blue
exceeds 4.5:1; navy/paper and muted text/surface exceed 4.5:1.

## Responsive layout QA — October 11, 2026

Verified using browser viewport overrides, not physical iPhones:

- iPhone 16: 393 × 852 portrait and 852 × 393 landscape.
- iPhone 16 Pro: 402 × 874 portrait and 874 × 402 landscape.
- Short portrait browser area: 393 × 660. Compact fallback: 320 × 568.
- Tablet: 768 × 1024. Desktop regression check: 1280 × 800.

Landing, demo, FAQ, footer, setup popup, sample trip, and unavailable page
were visually inspected. Planning private trips used an isolated localhost
fixture with sample data on ports 3002/3003; both temporary servers were
stopped afterward. No real records or hosted services were modified.

Checked that document width equals viewport width, visible images load,
boarding pass routes/times fit, and clouds/houses have room above the footer.
Mobile demo phones remain sticky during the conversation: final replies are
fully visible before the phone exits, typing appears between replies, and
scrolling up reverses visibility. Short viewports display messages statically.
The QR popup fits without internal scrolling and locks background scrolling.
Footer links have at least 44px tap targets. Private trip preview had no browser
console errors. The production build and TypeScript checks passed.

Viewport references: https://deviceatlas.com/blog/viewport-resolution-diagonal-screen-size-and-dpi-most-popular-smartphones
Native Safari on physical devices has not been tested in this environment.


## Parent itinerary and Vercel deployment — October 11, 2026

- Production website: https://wing-website-puce.vercel.app
- Vercel project: `aarnavbaxis-projects/wing-website`; repository root directory: `website`.
- `WING_BACKEND_URL` is configured to the existing Railway Wing service. No Supabase service credentials are stored on Vercel.
- Public site access is enabled with the user's explicit approval; trip pages still require an active 43-character bearer link.
- Shared trip pages reuse the sample boarding-pass layout with verified booked outbound/return segments, flight numbers, airport names, local dates/times, and confirmed simulated Uber pickup.
- Public summaries exclude exact pickup addresses, owner/trip/action IDs, private calendars/messages, booking references and payment information. Only confirmed rides associated with the verified flight reservation appear.
- Browser QA used synthetic booking data; no real traveler link was created or published. Bookings and rides remain simulated; scheduled times are not live tracking.
- Railway backend deployment `5f3ca318-bed5-47fc-8f13-0167e545833b` succeeded; `/health` returns 200. `WING_WEBSITE_URL=https://wing-website-puce.vercel.app` is configured.
- Applied `20261011000100_wing_trip_links.sql` and `20261011070000_wing_saved_home_ride_pickup.sql` to the production Supabase project in one transaction. SQL verification confirms the links table exists, row security is enabled, anonymous table reads are blocked, and saved-home pickup fallback is installed.
- Public Vercel-to-Railway request for a well-formed nonexistent token returns 404 rather than 503 after migration. No real traveler link was created for QA.
- All 131 tests pass, including booked flight/ride projections, approval and saved-address resolution, token scoping, and rejection of private nested fields. Both deployments are ready.

## Sharing domain and concise replies — October 11, 2026

- New trip links use `https://wing-hacknc.vercel.app`; public homepage returns 200 and a nonexistent trip token returns 404.
- Sharing authorization uses the existing isolated natural-language intent classifier, accepting family-itinerary requests without an exact keyword. Ownership and refusal checks remain enforced.
- Related sentences and single line breaks stay in one message; automatic pre-search acknowledgments are removed. Agent and presentation instructions discourage repeated explanations and unnecessary clarifications.
- TypeScript check and all 131 tests pass, including natural sharing/refusal, token preservation and delivery approval guards.

## Shared/sample layout parity — October 11, 2026

- Sample and booked shared pages now render the same `BookedTrip` and flight-card components. Route names, time displays, date ranges, stubs, ride heading, notice density and card order share one implementation.
- Verified the user-provided live itinerary through a local production preview at desktop, 393×852 and 320×568. Document width matches mobile viewport width; outbound and return cards preserve airport-local zones, next-day arrival, flight numbers and baggage uncertainty.
- Website TypeScript check, optimized build and diff whitespace check pass. No booking data was changed. Private-link screenshots remain temporary local artifacts, not repository assets.
