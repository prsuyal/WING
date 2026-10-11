"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Cloud, CloudBank, Icon, Plane, TravelDrawing } from "./artwork";
import { Footer } from "./brand";
import { Navigation } from "./navigation";
import type { PublicFlight } from "@/lib/public-summary";
import { summarySchema, type PlanningSummary } from "@/lib/summary";

function TripShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Navigation />
      <main className="trip-page">
        {children}
        <CloudBank />
        <TravelDrawing kind="home" />
      </main>
      <Footer />
    </>
  );
}

function BoardingHeader({ title, subtitle, children }: { title: string; subtitle: string; children?: React.ReactNode }) {
  return (
    <header className={`boarding-header${children ? " with-timeline" : ""}`}>
      <div className="boarding-header-copy"><h1>{title}</h1><p>{subtitle}</p></div>
      {children}
    </header>
  );
}

function BoardingRoute({ departure, arrival, planning = false, returning = false }: {
  departure: string | null;
  arrival: string | null;
  planning?: boolean;
  returning?: boolean;
}) {
  return (
    <div className="boarding-route">
      <div className="boarding-route-codes">
        <strong className="boarding-route-code">{departure ?? "—"}</strong>
        <div className="boarding-route-trail" aria-hidden="true"><span /><Plane /><span /></div>
        <strong className="boarding-route-code">{arrival ?? "—"}</strong>
      </div>
      <div className="boarding-route-details">
        <div className="boarding-airport">
          <span>{planning ? "Departure airport" : returning ? "Newark Liberty" : "Raleigh-Durham"}</span>
          {!planning && <><time>{returning ? "10:00 AM" : "5:10 PM"}</time>{!returning && <s aria-label="Originally 4:30 PM">4:30 PM</s>}</>}
        </div>
        <div className="boarding-airport destination">
          <span>{planning ? "Arrival airport" : returning ? "Raleigh-Durham" : "Newark Liberty"}</span>
          {!planning && <><time>{returning ? "11:35 AM" : "6:45 PM"}</time>{!returning && <s aria-label="Originally 6:05 PM">6:05 PM</s>}</>}
        </div>
      </div>
    </div>
  );
}

const sampleSummary: PlanningSummary = {
  displayName: "Aarnav", status: "booked", departureAirport: "RDU", arrivalAirport: "EWR",
  outboundDate: "2026-11-06", returnDate: "2026-11-09", updatedAt: "2026-11-06T20:15:00Z", simulated: true,
  booking: { airline: "Sample airline", cabin: "economy", baggage: "Carry-on", simulated: true,
    outbound: [{ flightNumber: "101", departureAirport: "RDU", arrivalAirport: "EWR", departureName: "Raleigh-Durham", arrivalName: "Newark Liberty", departureCity: "Raleigh", arrivalCity: "Newark", departsAt: "2026-11-06T22:10:00Z", arrivesAt: "2026-11-06T23:45:00Z", departureTimeZone: "America/New_York", arrivalTimeZone: "America/New_York" }],
    inbound: [{ flightNumber: "102", departureAirport: "EWR", arrivalAirport: "RDU", departureName: "Newark Liberty", arrivalName: "Raleigh-Durham", departureCity: "Newark", arrivalCity: "Raleigh", departsAt: "2026-11-09T15:00:00Z", arrivesAt: "2026-11-09T16:35:00Z", departureTimeZone: "America/New_York", arrivalTimeZone: "America/New_York" }],
  },
  ride: { provider: "Uber", status: "reserved", pickupLabel: "Campus pickup", airport: "RDU", pickupAt: "2026-11-06T19:00:00Z", airportAt: "2026-11-06T19:35:00Z", timeZone: "America/New_York", simulated: true },
};

export function SampleTrip() {
  return <TripShell><BookedTrip summary={sampleSummary} sample /></TripShell>;
}

function dateLabel(value: string | null) {
  if (!value) return "Not set yet";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function PlanningTrip({ summary }: { summary: PlanningSummary }) {
  const title = summary.displayName === "Your traveler"
    ? "Your traveler’s trip"
    : `${summary.displayName}’s trip`;
  return (
    <div className="trip-container boarding-view">
      <BoardingHeader title={title} subtitle={`${summary.departureAirport ?? "Departure not set"} to ${summary.arrivalAirport ?? "Destination not set"}`} />
      <div className="boarding-layout boarding-planning">
        <div className="boarding-flight-column">
          <div className="boarding-notice"><Icon name="plane" /><div><h2>Planning the journey</h2><p>Trip details are being worked out in Messages.</p></div></div>
          <section className="boarding-ticket" aria-labelledby="saved-details-title">
            <div className="boarding-ticket-body">
              <div className="boarding-ticket-heading"><h2 id="saved-details-title">Saved trip details</h2><span>Planning</span></div>
              <BoardingRoute departure={summary.departureAirport} arrival={summary.arrivalAirport} planning />
              {(!summary.departureAirport || !summary.arrivalAirport) && <p className="boarding-secondary">Airports not confirmed yet.</p>}
            </div>
            <dl className="boarding-ticket-stub">
              <div><dt>Outbound date</dt><dd>{dateLabel(summary.outboundDate)}</dd></div>
              <div><dt>Return date</dt><dd>{dateLabel(summary.returnDate)}</dd></div>
            </dl>
          </section>
          <p className="boarding-secondary boarding-confirmed">Only confirmed trip details appear here.</p>
        </div>
        <section className="boarding-afternoon" aria-labelledby="next-steps-title">
          <h2 id="next-steps-title">What’s next</h2>
          <ol className="boarding-timeline planning">
            <li><Icon name="plane" /><h3>Flight not booked</h3><p>No flight itinerary is available yet.</p></li>
            <li><Icon name="car" /><h3>Airport ride not arranged</h3><p>No pickup time or ride reservation yet.</p></li>
          </ol>
        </section>
      </div>
      <p className="boarding-updated">Last updated: {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(summary.updatedAt))} UTC</p>
    </div>
  );
}

function localTime(instant: string, zone: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone: zone }).format(new Date(instant));
}
function localDay(instant: string, zone: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: zone }).format(new Date(instant));
}
function clockTime(instant: string, zone: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone }).format(new Date(instant));
}
function flightDay(instant: string, zone: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: zone }).format(new Date(instant));
}
function shortAirport(name: string) {
  return name.replace(/\s+(?:International\s+)?Airport$/i, "");
}
function tripDates(start: string | null, end: string | null) {
  if (!start || !end) return `${dateLabel(start)} – ${dateLabel(end)}`;
  if (start.slice(0, 7) === end.slice(0, 7)) {
    const month = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(`${start}T12:00:00Z`));
    return `${month} ${Number(start.slice(8))}–${Number(end.slice(8))}, ${end.slice(0, 4)}`;
  }
  return `${dateLabel(start)} – ${dateLabel(end)}`;
}
function BookedFlightPass({ legs, name, traveler, baggage, sample = false, returning = false }: { legs: PublicFlight[]; name: string; traveler: string; baggage: string; sample?: boolean; returning?: boolean }) {
  return <section className="boarding-ticket" aria-label={name}>
    <div className="boarding-ticket-body">
      <div className="boarding-ticket-heading"><h2>{name}</h2><span>{flightDay(legs[0].departsAt, legs[0].departureTimeZone)}</span></div>
      {legs.map((leg, index) => {
        const arrivesNextDay = flightDay(leg.departsAt, leg.departureTimeZone) !== flightDay(leg.arrivesAt, leg.arrivalTimeZone);
        const depZone = localTime(leg.departsAt, leg.departureTimeZone).replace(clockTime(leg.departsAt, leg.departureTimeZone), "").trim();
        const arrZone = localTime(leg.arrivesAt, leg.arrivalTimeZone).replace(clockTime(leg.arrivesAt, leg.arrivalTimeZone), "").trim();
        return <div key={`${leg.flightNumber}-${leg.departsAt}`}>
          {index > 0 && <p className="boarding-secondary">Connection in {leg.departureCity} · {leg.flightNumber}</p>}
          <div className="boarding-route">
            <div className="boarding-route-codes"><strong className="boarding-route-code">{leg.departureAirport}</strong><div className="boarding-route-trail" aria-hidden="true"><span /><Plane /><span /></div><strong className="boarding-route-code">{leg.arrivalAirport}</strong></div>
            <div className="boarding-route-details">
              <div className="boarding-airport"><span>{shortAirport(leg.departureName)}</span><time dateTime={leg.departsAt}>{clockTime(leg.departsAt, leg.departureTimeZone)}</time>{sample && !returning && <s aria-label="Originally 4:30 PM">4:30 PM</s>}</div>
              <div className="boarding-airport destination"><span>{shortAirport(leg.arrivalName)}</span><time dateTime={leg.arrivesAt}>{clockTime(leg.arrivesAt, leg.arrivalTimeZone)}</time>{sample && !returning && <s aria-label="Originally 6:05 PM">6:05 PM</s>}</div>
            </div>
          </div>
          <p className="boarding-timezone">{arrivesNextDay ? `Arrives ${flightDay(leg.arrivesAt, leg.arrivalTimeZone)} · ` : ""}{depZone === arrZone ? `All flight times in ${depZone}` : `${depZone} departure · ${arrZone} arrival`}</p>
        </div>;
      })}
      <p className="boarding-secondary boarding-baggage">{baggage}</p>
    </div>
    <div className="boarding-ticket-stub"><dl className="boarding-ticket-fields"><div><dt>Flight</dt><dd>{legs.map(leg => leg.flightNumber).join(" / ")}</dd></div><div><dt>Traveler</dt><dd>{traveler === "Your traveler" ? "Traveler" : traveler}</dd></div></dl><span className="boarding-stamp" aria-hidden="true">{sample ? returning ? "Back to campus" : "Heading home" : returning ? "Returning" : "Outbound"}</span></div>
  </section>;
}
export function BookedTrip({ summary, sample = false }: { summary: PlanningSummary; sample?: boolean }) {
  const booking = summary.booking!;
  const first = booking.outbound[0], last = booking.outbound.at(-1)!;
  const traveler = summary.displayName === "Your traveler" ? "Your traveler" : summary.displayName;
  const title = traveler === "Your traveler" ? `Trip to ${last.arrivalCity}.` : `${traveler}’s trip${sample ? " home" : ""}.`;
  return <div className="trip-container boarding-view">
    <BoardingHeader title={title} subtitle={`${first.departureCity} to ${last.arrivalCity} · ${tripDates(summary.outboundDate, summary.returnDate)}`}>
      <section className="boarding-header-timeline" aria-label="Journey schedule"><h2>{traveler === "Your traveler" ? "The journey" : `${traveler}’s journey`}</h2><ol className="boarding-timeline horizontal">
        {summary.ride && <li><time dateTime={summary.ride.pickupAt}>{clockTime(summary.ride.pickupAt, summary.ride.timeZone)}</time><h3>Ride to {summary.ride.airport}</h3><p>{summary.ride.pickupLabel} · Reserved</p></li>}
        <li className={sample ? "current" : undefined}><time dateTime={first.departsAt}>{clockTime(first.departsAt, first.departureTimeZone)}</time><h3>Take off</h3><p>{sample ? "Updated departure" : "Scheduled"} · Flight {first.flightNumber}</p></li>
        <li><time dateTime={last.arrivesAt}>{clockTime(last.arrivesAt, last.arrivalTimeZone)}</time><h3>Land at {last.arrivalCity}</h3><p>{sample ? "Estimated arrival" : "Scheduled arrival"}</p></li>
      </ol></section>
    </BoardingHeader>
    <div className="boarding-layout">
      <div className="boarding-flight-column">
        <div className={`boarding-notice${sample ? " delayed" : ""}`}><Icon name={sample ? "clock" : "plane"} /><div><h2>{sample ? "Flight delayed by 40 minutes." : "Your trip itinerary"}</h2><p>{sample ? "Now departing at 5:10 PM ET." : "Simulated flight and Uber reservations."}</p></div></div>
        <BookedFlightPass legs={booking.outbound} name="Outbound flight" traveler={traveler} baggage={booking.baggage} sample={sample} />
      </div>
      <div className="boarding-secondary-column">
        <section className="boarding-ride" aria-labelledby="shared-ride-title"><div className="boarding-ride-heading"><Icon name="car" /><h2 id="shared-ride-title">Airport ride</h2><span>{summary.ride ? "Reserved" : "Not arranged"}</span></div>
          {summary.ride ? <><p>{summary.ride.pickupLabel.replace(" pickup", "")} → {summary.ride.airport}</p><p className="boarding-secondary">{sample ? <>Pickup stays at 2:00 PM ET.<br />Your ride time hasn’t changed.</> : <>Uber pickup at {localTime(summary.ride.pickupAt, summary.ride.timeZone)}.<br />At the airport by {localTime(summary.ride.airportAt, summary.ride.timeZone)}.</>}</p></> : <p className="boarding-secondary">No airport ride reserved yet.</p>}
        </section>
        <div className="boarding-return compact"><BookedFlightPass legs={booking.inbound} name="Return flight" traveler={traveler} baggage={booking.baggage} sample={sample} returning /></div>
      </div>
    </div>
    <p className="boarding-updated">Updated {localDay(summary.updatedAt, first.departureTimeZone)} at {localTime(summary.updatedAt, first.departureTimeZone)}</p>
  </div>;
}
function ShareTripButton() {
  const [message, setMessage] = useState("");
  async function share() {
    if (["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) { setMessage("This is a local preview. A hosted website link is needed to share with family."); return; }
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: "Wing trip", url });
      else { await navigator.clipboard.writeText(url); setMessage("Link copied. Anyone with it can view this trip until it expires or is revoked."); }
    } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) setMessage("Copy this page’s address to share the trip."); }
  }
  return <div className="trip-container trip-share"><button className="button primary" onClick={share}>Share trip link <Icon name="arrow" /></button>{message && <p className="boarding-secondary" role="status">{message}</p>}</div>;
}

export function SharedTrip({ token }: { token: string }) {
  const [summary, setSummary] = useState<PlanningSummary | null>(null);
  const [state, setState] = useState<
    "loading" | "ready" | "stale" | "error" | "unavailable"
  >("loading");
  const [retry, setRetry] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const hasSummary = useRef(false);
  const previous = useRef("");
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let failures = 0;
    let busy = false;
    let unavailable = false;
    const poll = async () => {
      if (disposed || busy || document.hidden || unavailable) return;
      clearTimeout(timer);
      busy = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 10_000);
      try {
        const response = await fetch(`/api/trips/${token}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (disposed) return;
        if (response.status === 404) {
          setSummary(null);
          hasSummary.current = false;
          setState("unavailable");
          unavailable = true;
          return;
        }
        if (!response.ok) throw new Error("Unavailable");
        const next = summarySchema.parse(await response.json());
        if (disposed) return;
        const signature = JSON.stringify(next);
        if (previous.current && previous.current !== signature)
          setAnnouncement("Trip details updated.");
        previous.current = signature;
        hasSummary.current = true;
        setSummary(next);
        setState("ready");
        failures = 0;
      } catch {
        if (!disposed) {
          failures++;
          setState(hasSummary.current ? "stale" : "error");
        }
      } finally {
        clearTimeout(timeout);
        busy = false;
        if (!disposed && !unavailable)
          timer = setTimeout(poll, Math.min(15_000 * 2 ** failures, 120_000));
      }
    };
    const visibility = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void poll();
      }
    };
    document.addEventListener("visibilitychange", visibility);
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [token, retry]);
  return (
    <TripShell>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {state === "stale" && (
        <div className="stale-notice" role="status">
          Updates are temporarily unavailable. Showing the last saved details.{" "}
          <button onClick={() => setRetry((n) => n + 1)}>Retry now</button>
        </div>
      )}
      {summary && <>{summary.booking ? <BookedTrip summary={summary} /> : <PlanningTrip summary={summary} />}<ShareTripButton /></>}{" "}
      {!summary && (
        <div className="trip-state">
          <Cloud className="state-cloud" />
          <Icon name={state === "unavailable" ? "info" : "plane"} />
          <h1>
            {state === "loading"
              ? "Finding your trip…"
              : state === "unavailable"
                ? "This link is unavailable."
                : "We couldn’t load this trip."}
          </h1>
          <p>
            {state === "loading"
              ? "Getting the latest saved details."
              : state === "unavailable"
                ? "It may have expired or been revoked. Ask the traveler for a new link."
                : "The trip service may be offline. Please try again in a moment."}
          </p>
          {state === "error" && (
            <button
              className="button primary"
              onClick={() => {
                setState("loading");
                setRetry((n) => n + 1);
              }}
            >
              Try again
            </button>
          )}
          <Link className="text-link" href="/">
            Back to Wing <Icon name="arrow" />
          </Link>
        </div>
      )}
    </TripShell>
  );
}
