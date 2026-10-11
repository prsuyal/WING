# Wing website copy

Editable copy review sheet for the current website. Edit the wording below, then ask Codex to apply the revised copy to the website. This Markdown file does not automatically update the rendered pages.

Speaker labels, field labels, and section headings organize the copy; only their values appear on the website unless indicated. Keep `wing` lowercase in the logo and `Wing` elsewhere. `{placeholders}` represent data supplied by the application.

## Navigation and footer

- Logo: wing
- Navigation link: How it works
- Navigation link: FAQ
- Setup button: Set up Wing
- Footer tagline: Home is a text away.
- Private-trip footer: Read-only trip link.
- Private-trip footer detail: Anyone with this active link can view these trip details.

## Landing page — hero

### Headline

Home is
a text away.

### Description

Schedule a flight with a text.
Airport rides sorted. Family in the loop.

### Actions

- Set up Wing
- See how it works

### Hero conversation

1. Traveler: Are there any flights home this weekend?
2. Wing: The best flight home is on Saturday at 1:00 PM. Want me to book it?
3. Traveler: Yep

### Hero flight card

- Label: Your flight
- Route: RDU → EWR
- Date: Fri, Nov 6
- Time: 4:30 PM – 6:05 PM ET
- Price: $255
- Fare label: round trip

## Landing page — demo

### Section heading

One text. The whole trip.

### Step 1

Headline: Wing remembers your way home.

Description: Tell Wing where you usually fly, and it’ll remember for next time.

Note: A little less explaining. A lot more getting home.

Messages:

1. Traveler: Get me home next weekend
2. Wing: Of course. RDU to EWR after your Friday classes?
3. Traveler: Yep

### Step 2

Headline: Wing adapts to your schedule.

Description: Compare flights and find the option that works best for you.

Note: Plans change? Wing keeps up.

Messages:

1. Wing: Flights from CLT to JFK are only $287 this Friday. Wanna book one?
2. Traveler: Are there any flights on Thursday?
3. Wing: There’s a flight at 1:39 PM on Thursday but tickets start at $330. Want me to book this one?
4. Traveler: Yes. Book the Thursday flight.

Boarding pass illustration: BOARDING PASS · CLT → JFK · THU · 1:39 PM · GATE B12.

### Step 3

Headline: Wing books Ubers for you.

Description: Sort out your Uber ride in the same conversation.

Note: From campus to the gate.

Messages:

1. Wing: Want a ride to the airport? From Hardin Residence Hall to RDU at 4:00 PM. Fares are around $28.
2. Traveler: Yes please

### Step 4

Headline: Wing shows your trip summary.

Description: Keep your flight and airport ride together, and share the trip with family.

Note: All the details in one place.

Trip card:

- Heading: Trip summary
- Flight: RDU → EWR
- Flight details: Fri, Nov 6 · 4:30 PM – 6:05 PM ET
- Ride label: Airport ride
- Ride details: Hardin Residence Hall → RDU · 4:00 PM ET
- Arrival label: Arrive at EWR
- Arrival time: 6:05 PM ET
- Button: View sample trip

### iPhone screens — shared labels

- Contact: Wing
- Status-bar time: 9:41
- Conversation type: iMessage
- Conversation timestamp: Today 9:41 AM
- Composer placeholder: iMessage

## Landing page — FAQ

Heading: Frequently Asked Questions

### What is Wing?

Wing is a AI travel companion in iMessage, that recommends and books flights for you. It remembers your preferences and helps you keep your trip details together.

### How much does it cost?

Wing is completely free!

### How do I set it up?

Tap "Set up Wing" and scan the QR code to add Wing to your contacts.

### Is Wing open source?

Wing is open source. You can check out the code at https://github.com/prsuyal/WING

### Do I need to download an app?

There’s no separate Wing app to download. Just text the number to get started.


## Landing page — closing section

Headline: Ready to head home?

Description: Get flights, rides, and peace of mind. All over iMessage.

Button: Set up Wing

Helper: Save Wing as a contact. Say hey in Messages.

## Setup popup

- Logo: wing (same wordmark as the navbar)
- Headline: Your way home starts here.
- Description: Meet Wing on your phone.
- QR fallback: Contact QR code is loading.
- QR helper: Scan the code to add Wing to your contacts.
- QR destination (temporary): https://example.com/wing-contact.vcf

## Sample trip / receipt page

### Header and status

- Heading: Aarnav's trip home.
- Subtitle: Raleigh to Newark · November 6–9, 2026
- Status heading: Flight delayed by 40 minutes.
- Departure: Now departing at 5:10 PM ET.
- Timestamp: Updated Nov 6, 2026 at 3:15 PM ET

### Boarding pass

- Heading: Outbound flight
- Date: Fri, Nov 6
- Departure airport: RDU
- Departure name: Raleigh-Durham
- Revised departure: 5:10 PM
- Original departure (crossed out): 4:30 PM
- Arrival airport: EWR
- Arrival name: Newark Liberty
- Revised arrival: 6:45 PM
- Original arrival (crossed out): 6:05 PM
- Timezone helper: All flight times in Eastern Time
- Flight label: Flight
- Flight number: 101
- Traveler label: Traveler
- Traveler name: Aarnav
- Decorative stamp: Heading home

### Return boarding pass
- Ticket heading: Return flight
- Date: Mon, Nov 9
- Departure airport: EWR
- Departure name: Newark Liberty
- Departure: 10:00 AM
- Arrival airport: RDU
- Arrival name: Raleigh-Durham
- Arrival: 11:35 AM
- Timezone helper: All flight times in Eastern Time
- Flight label: Flight
- Flight number: 102
- Traveler label: Traveler
- Traveler name: Aarnav
- Decorative stamp: Back to campus

### Timeline

Heading: Aarnav's journey

1. 2:00 PM — Ride to RDU — Campus pickup · Reserved
2. 5:10 PM — Take off — Updated departure · Flight 101
3. 6:45 PM — Land at Newark — Estimated arrival

### Airport ride

- Heading: Airport ride
- Status: Reserved
- Route: Campus → RDU
- Pickup: Pickup stays at 2:00 PM ET.
- Update: Your ride time hasn’t changed.

## Private trip page

### Trip header

- Default title: Your traveler’s trip
- Personalized title: {displayName}’s trip
- Route: {departureAirport} to {arrivalAirport}
- Missing departure: Departure not set
- Missing destination: Destination not set
- Status heading: Planning the journey
- Description: Trip details are being worked out in Messages.
- Timestamp: Last updated: {updatedAt} UTC

### Saved details

- Heading: Saved trip details
- Field: Departure airport
- Field: Arrival airport
- Field: Outbound date
- Field: Return date
- Missing airport: —
- Missing-airports helper: Airports not confirmed yet.
- Ticket status: Planning
- Missing date: Not set yet
- Helper: Only confirmed trip details appear here.

### Next steps

- Heading: What’s next
- Flight heading: Flight not booked
- Flight detail: No flight itinerary is available yet.
- Ride heading: Airport ride not arranged
- Ride detail: No pickup time or ride reservation yet.

### Loading, errors, and updates

- Loading heading: Finding your trip…
- Loading detail: Getting the latest saved details.
- Unavailable heading: This link is unavailable.
- Unavailable detail: It may have expired or been revoked. Ask the traveler for a new link.
- Error heading: We couldn’t load this trip.
- Error detail: The trip service may be offline. Please try again in a moment.
- Error button: Try again
- Home link: Back to Wing
- Stale-data notice: Updates are temporarily unavailable. Showing the last saved details.
- Stale-data button: Retry now
- Screen-reader update announcement: Trip details updated.

## Page not found

- Heading: This page is unavailable.
- Description: If you’re opening a trip link, ask the traveler for a new one.
- Button: Back to Wing

## Browser titles and descriptions

- Default title: Wing
- Title template: {pageTitle}
- Default description: Your way home, right in Messages. Meet Wing, a travel companion for the journey from campus to home.
- Sample trip title: Sample Trip
- Sample trip description: A Wing trip summary with flight details, airport rides, and journey updates.
- Private trip title: Shared trip
- Private trip description: A private, read-only Wing trip summary.

## Accessibility labels

- Skip link: Skip to content
- Logo link: Wing home
- Main navigation: Main
- Footer navigation: Footer
- Contact image: Wing contact photo
- Popup close button: Close setup
- QR image: QR code to the Wing contact card