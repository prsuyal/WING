"use client";

import { useLayoutEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { Icon, Plane, TravelDrawing } from "./artwork";

function MessageSequence({
  children,
  scrollDriven = true,
}: {
  children: React.ReactNode;
  scrollDriven?: boolean;
}) {
  const sequence = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = sequence.current;
    if (!scrollDriven || !element) return;

    const messages = Array.from(element.children) as HTMLElement[];
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let disposed = false;

    const update = () => {
      frame = 0;
      if (disposed) return;
      // Measure the stationary container, never the animated message boxes.
      const { top, height } = element.getBoundingClientRect();
      const viewport = window.innerHeight;
      const scene = element.closest<HTMLElement>(".scene");
      const visual = element.closest<HTMLElement>(".scene-visual");
      const handheld = window.matchMedia("(max-width: 900px)").matches;
      let progress = (viewport * 0.85 - top) / (height + viewport * 0.4);
      if (handheld && scene && visual) {
        // The phone stays in view while the stationary scene supplies scroll distance.
        // Finish every message before the phone leaves its sticky position.
        const bounds = scene.getBoundingClientRect();
        const copyHeight = scene.querySelector(".scene-copy")?.getBoundingClientRect().height ?? 0;
        const start = bounds.top + copyHeight + 24 - viewport * 0.65;
        const end = bounds.bottom - visual.getBoundingClientRect().height - 32;
        progress = -start / Math.max(1, end - start);
      }
      progress = Math.max(0, Math.min(1, progress));
      const staticMessages = preference.matches || (handheld && viewport < 640);
      messages.forEach((message, index) => {
        const phase = Math.max(0, Math.min(1, progress * messages.length - index));
        const incoming = message.classList.contains("incoming");
        // Hold typing through the first 75% of a reply’s scroll interval.
        const reveal = staticMessages ? 1 : incoming
          ? Math.max(0, (phase - 0.75) / 0.25)
          : phase;
        const eased = reveal * reveal * (3 - 2 * reveal);
        const typing = staticMessages || !incoming ? 0 : Math.max(0,
          Math.min(1, phase / 0.08, (0.75 - phase) / 0.08),
        );
        message.style.setProperty("--message-reveal", String(eased));
        message.style.setProperty("--typing-reveal", String(typing));
        message.style.setProperty("--typing-play-state", typing > 0 ? "running" : "paused");
      });
    };
    const schedule = () => {
      if (!frame && !disposed) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("load", schedule);
    preference.addEventListener("change", schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    document.fonts.ready.then(schedule);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("load", schedule);
      preference.removeEventListener("change", schedule);
      messages.forEach((message) => {
        message.style.removeProperty("--message-reveal");
        message.style.removeProperty("--typing-reveal");
        message.style.removeProperty("--typing-play-state");
      });
    };
  }, [scrollDriven]);

  return (
    <div
      ref={sequence}
      className={`conversation-body${scrollDriven ? " scroll-message-sequence" : ""}`}
    >
      {children}
    </div>
  );
}

export function Bubble({ sent = false, children }: { sent?: boolean; children: React.ReactNode }) {
  return (
    <div className={`message-slot ${sent ? "outgoing" : "incoming"}`}>
      <div className={`bubble ${sent ? "sent" : "received"}`}>
        {children}
      </div>
      {!sent && (
        <div className="typing-bubble" aria-hidden="true">
          <span /><span /><span />
        </div>
      )}
    </div>
  );
}

export function FlightOption() {
  return (
    <div className="flight-option">
      <span className="card-label">Your flight</span>
      <div className="flight-route">
        <strong>RDU</strong><span className="flight-dashes" /><Plane /><span className="flight-dashes" /><strong>EWR</strong>
      </div>
      <div className="flight-meta">
        <p>Fri, Nov 6<br />4:30 PM – 6:05 PM ET</p>
        <p><strong>$255</strong><br />round trip</p>
      </div>
    </div>
  );
}

function IPhoneChat({ hero = false, children }: { hero?: boolean; children: React.ReactNode }) {
  return (
    <div className={`conversation iphone-chat ${hero ? "hero-phone" : "story-chat"}`}>
      <div className="iphone-screen">
        <div className="iphone-status" aria-hidden="true">
          <span>9:41</span>
          <span className="dynamic-island" />
          <svg viewBox="0 0 64 18" className="iphone-status-icons" fill="currentColor">
            <rect x="0" y="11" width="3" height="5" rx="1" /><rect x="5" y="8" width="3" height="8" rx="1" /><rect x="10" y="5" width="3" height="11" rx="1" /><rect x="15" y="2" width="3" height="14" rx="1" />
            <path d="M23 6q8-8 16 0l-2 2q-6-6-12 0Zm4 4q4-4 8 0l-2 2q-2-2-4 0Zm3 4 1-1 1 1-1 2Z" />
            <rect x="44" y="3" width="17" height="12" rx="3" fill="none" stroke="currentColor" /><rect x="46" y="5" width="13" height="8" rx="1" /><rect x="62" y="7" width="2" height="4" rx="1" />
          </svg>
        </div>
        <div className="iphone-contact-header">
          <svg className="iphone-back" viewBox="0 0 20 28" aria-hidden="true"><path d="m14 5-9 9 9 9" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <div className="iphone-contact">
            <Image src="/images/wing_contact.png" alt="Wing contact photo" width={44} height={44} />
            <span>Wing <span aria-hidden="true">›</span></span>
          </div>
          <svg className="iphone-video" viewBox="0 0 28 24" aria-hidden="true"><rect x="2" y="5" width="16" height="14" rx="4" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="m18 9 7-4v14l-7-4Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
        </div>
        <div className="iphone-chat-date" aria-hidden="true">iMessage<br /><strong>Today</strong> 9:41 AM</div>
        {children}
        <div className="iphone-composer" aria-hidden="true">
          <span className="iphone-add">+</span>
          <div><span>iMessage</span><span className="iphone-send">↑</span></div>
        </div>
        <div className="iphone-home-indicator" aria-hidden="true" />
      </div>
    </div>
  );
}

export function Conversation({ hero = false }: { hero?: boolean }) {
  const phone = (
    <IPhoneChat hero={hero}>
      <MessageSequence scrollDriven={!hero}>
        <Bubble sent>{hero ? "Are there any flights home this weekend?" : "Get me home next weekend"}</Bubble>
        <Bubble>{hero ? "The best flight home is on Saturday at 1:00 PM. Want me to book it?" : "Of course. RDU to EWR after your Friday classes?"}</Bubble>
        <Bubble sent>Yep</Bubble>
        {hero && <FlightOption />}
      </MessageSequence>
    </IPhoneChat>
  );
  return hero ? <div className="hero-phone-wrap">{phone}</div> : phone;
}

function AlternativesPreview() {
  return (
    <IPhoneChat>
      <MessageSequence>
        <Bubble>Flights from CLT to JFK are only $287 this Friday. Wanna book one?</Bubble>
        <Bubble sent>Are there any flights on Thursday?</Bubble>
        <Bubble>There’s a flight at 1:39 PM on Thursday but tickets start at $330. Want me to book this one?</Bubble>
        <Bubble sent>Yes. Book the Thursday flight.</Bubble>
      </MessageSequence>
    </IPhoneChat>
  );
}

function RidePreview() {
  return (
    <IPhoneChat>
      <MessageSequence>
        <Bubble>Want a ride to the airport? From Hardin Residence Hall to RDU at 4:00 PM. Fares are around $28.</Bubble>
        <Bubble sent>Yes please</Bubble>
      </MessageSequence>
    </IPhoneChat>
  );
}

export function TripPreview() {
  return (
    <div className="trip-preview" id="trip-preview">
      <h3>Trip summary</h3>
      <ol>
        <li><span className="icon-circle"><Icon name="plane" /></span><div><strong>RDU → EWR</strong><p>Fri, Nov 6 · 4:30 PM – 6:05 PM ET</p></div></li>
        <li><span className="icon-circle"><Icon name="car" /></span><div><strong>Airport ride</strong><p>Hardin Residence Hall → RDU · 4:00 PM ET</p></div></li>
        <li><span className="icon-circle"><Icon name="pin" /></span><div><strong>Arrive at EWR</strong><p>6:05 PM ET</p></div></li>
      </ol>
      <Link className="button secondary" href="/demo/trip">View sample trip <Icon name="arrow" /></Link>
    </div>
  );
}

export function SceneVisual({ scene }: { scene: number }) {
  if (scene === 0) return <Conversation />;
  if (scene === 1) return <AlternativesPreview />;
  if (scene === 2) return <><RidePreview /><TravelDrawing kind="ride" /></>;
  return <TripPreview />;
}
