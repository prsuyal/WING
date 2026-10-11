"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Cloud, CloudBank, Icon, Plane, TravelDrawing } from "./artwork";
import { Footer } from "./brand";
import { Navigation } from "./navigation";
import { summarySchema, type PlanningSummary } from "@/lib/summary";

function TripShell({
  children,
  sample = false,
}: {
  children: React.ReactNode;
  sample?: boolean;
}) {
  return (
    <>
      <Navigation />
      <main className="trip-page">
        {children}
        <CloudBank />
        <TravelDrawing kind="home" />
      </main>
      <Footer privateTrip={!sample} />
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

function FlightBoardingPass({ returning = false }: { returning?: boolean }) {
  const titleId = returning ? "return-title" : "outbound-title";
  return (
    <section className="boarding-ticket" aria-labelledby={titleId}>
      <div className="boarding-ticket-body">
        <div className="boarding-ticket-heading"><h2 id={titleId}>{returning ? "Return flight" : "Outbound flight"}</h2><span>{returning ? "Mon, Nov 9" : "Fri, Nov 6"}</span></div>
        <BoardingRoute departure={returning ? "EWR" : "RDU"} arrival={returning ? "RDU" : "EWR"} returning={returning} />
        <p className="boarding-timezone">All flight times in Eastern Time</p>
      </div>
      <div className="boarding-ticket-stub">
        <dl className="boarding-ticket-fields">
          <div><dt>Flight</dt><dd>{returning ? "102" : "101"}</dd></div>
          <div><dt>Traveler</dt><dd>Aarnav</dd></div>
        </dl>
        <span className="boarding-stamp" aria-hidden="true">{returning ? "Back to campus" : "Heading home"}</span>
      </div>
    </section>
  );
}

export function SampleTrip() {
  return (
    <TripShell sample>
      <div className="trip-container boarding-view">
        <BoardingHeader title="Aarnav's trip home." subtitle="Raleigh to Newark · November 6–9, 2026">
          <section className="boarding-header-timeline" aria-labelledby="afternoon-title">
            <h2 id="afternoon-title">Alex’s journey</h2>
            <ol className="boarding-timeline horizontal">
              <li><time>2:00 PM</time><h3>Ride to RDU</h3><p>Campus pickup · Reserved</p></li>
              <li className="current"><time>5:10 PM</time><h3>Take off</h3><p>Updated departure · Flight 101</p></li>
              <li><time>6:45 PM</time><h3>Land at Newark</h3><p>Estimated arrival</p></li>
            </ol>
          </section>
        </BoardingHeader>
        <div className="boarding-layout">
          <div className="boarding-flight-column">
            <div className="boarding-notice delayed">
              <Icon name="clock" />
              <div><h2>Flight delayed by 40 minutes.</h2><p>Now departing at 5:10 PM ET.</p></div>
            </div>
            <FlightBoardingPass />
          </div>
          <div className="boarding-secondary-column">
          <section className="boarding-ride" aria-labelledby="ride-title">
            <div className="boarding-ride-heading"><Icon name="car" /><h2 id="ride-title">Airport ride</h2><span>Reserved</span></div>
            <p>Campus → RDU</p><p className="boarding-secondary">Pickup stays at 2:00 PM ET.<br />Your ride time hasn’t changed.</p>
          </section>

          <div className="boarding-return compact">
            <FlightBoardingPass returning />
          </div>
          </div>
        </div>
        <p className="boarding-updated">Updated Nov 6, 2026 at 3:15 PM ET</p>
      </div>
    </TripShell>
  );
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
      {summary && <PlanningTrip summary={summary} />}{" "}
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
