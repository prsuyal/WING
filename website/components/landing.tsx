"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { Cloud, CloudBank, Icon, Plane, PlaneShape, TravelDrawing } from "./artwork";
import { Footer } from "./brand";
import { Navigation } from "./navigation";
import { Conversation, SceneVisual } from "./previews";
import { SetupTrigger } from "./setup";

const scenes = [
  {
    title: <>Wing remembers<br />your way home.</>,
    text: "Tell Wing where you usually fly, and it’ll remember for next time.",
    note: "A little less explaining. A lot more getting home.",
  },
  {
    title: <>Wing adapts<br />to your schedule.</>,
    text: "Compare flights and find the option that works best for you.",
    note: "Plans change? Wing keeps up.",
  },
  {
    title: <>Wing books Ubers<br />for you.</>,
    text: "Sort out your Uber ride in the same conversation.",
    note: "From campus to the gate.",
  },
  {
    title: <>Wing shows<br />your trip summary.</>,
    text: "Keep your flight and airport ride together, and share the trip with family.",
    note: "All the details in one place.",
  },
];
const faqs: [string, React.ReactNode][] = [
  ["What is Wing?", "Wing is a AI travel companion in iMessage, that recommends and books flights for you. It remembers your preferences and helps you keep your trip details together."],
  ["How much does it cost?", "Wing is completely free!"],
  ["How do I set it up?", "Tap \"Set up Wing\" and scan the QR code to add Wing to your contacts."],
  ["Is Wing open source?", <>Wing is open source. You can check out the code at <a href="https://github.com/prsuyal/WING">https://github.com/prsuyal/WING</a></>],
  ["Do I need to download an app?", "There’s no separate Wing app to download. Just text the number to get started!"],
];

function FAQ() {
  const [open, setOpen] = useState<number | null>(null);
  const reduced = useReducedMotion();
  return (
    <section className="faq-section" id="faq">
      <Cloud className="faq-cloud left" />
      <Cloud className="faq-cloud right" />
      <h2>Frequently Asked Questions</h2>
      <div className="faq-list">
        {faqs.map(([question, answer], index) => (
          <div
            className={`faq-row ${open === index ? "open" : ""}`}
            key={question}
          >
            <h3>
              <button
                aria-expanded={open === index}
                aria-controls={open === index ? `faq-answer-${index}` : undefined}
                onClick={() => setOpen(open === index ? null : index)}
              >
                {question}
                <span aria-hidden="true">{open === index ? "−" : "+"}</span>
              </button>
            </h3>
            <AnimatePresence initial={false}>
              {open === index && (
                <motion.div
                  id={`faq-answer-${index}`}
                  initial={{ height: reduced ? "auto" : 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: reduced ? "auto" : 0, opacity: 0 }}
                  transition={{ duration: reduced ? 0 : 0.2 }}
                >
                  <p>{answer}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </section>
  );
}

function Walkthrough() {
  const story = useRef<HTMLElement>(null);
  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger, MotionPathPlugin);
    const media = gsap.matchMedia();
    media.add(
      "(min-width: 901px) and (prefers-reduced-motion: no-preference)",
      () => {
        const path =
          story.current?.querySelector<SVGPathElement>(".story-flight-path");
        const plane = story.current?.querySelector(".story-moving-plane");
        const heading = story.current?.querySelector(".story-plane-heading");
        if (!path || !plane || !heading) return;
        let direction = 1;
        gsap.set(plane, { opacity: 1 });
        gsap.set(heading, { svgOrigin: "0 0", rotation: 0 });
        gsap.to(plane, {
          ease: "none",
          motionPath: {
            path,
            align: path,
            alignOrigin: [0.5, 0.5],
            // The artwork’s nose points along (23, -25), rather than +X.
            autoRotate: Math.atan2(25, 23) * 180 / Math.PI,
          },
          scrollTrigger: {
            trigger: path.closest(".scenes"),
            start: "top 45%",
            end: "bottom 65%",
            scrub: true,
            invalidateOnRefresh: true,
            onUpdate: (trigger) => {
              if (trigger.direction === direction) return;
              direction = trigger.direction;
              gsap.set(heading, { rotation: direction < 0 ? 180 : 0 });
            },
          },
        });
      },
      story,
    );
    // Fonts, images, and responsive hero sizing can move the whole walkthrough.
    let refreshFrame = 0;
    let disposed = false;
    const refresh = () => {
      if (disposed || refreshFrame) return;
      refreshFrame = window.requestAnimationFrame(() => {
        refreshFrame = 0;
        ScrollTrigger.refresh();
      });
    };
    const observer = new ResizeObserver(refresh);
    observer.observe(document.body);
    document.fonts.ready.then(refresh);
    window.addEventListener("load", refresh);
    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener("load", refresh);
      window.cancelAnimationFrame(refreshFrame);
      media.revert();
    };
  }, []);
  return (
    <section className="walkthrough" id="how-it-works" ref={story}>
      <div className="story-heading">
        <h2>One text. The whole trip.</h2>
      </div>
      <div className="scenes">
        <svg
          className="story-trail"
          viewBox="0 0 100 1500"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            className="story-flight-path"
            d="M50 12C78 80 22 124 50 227S78 310 50 402 22 520 50 600 78 736 50 814 22 930 50 1010 78 1150 50 1220 22 1314 50 1480"
            fill="none"
            stroke="#052D68"
            strokeWidth="3"
            strokeDasharray="7 10"
            strokeLinecap="round"
          />
          <g className="story-moving-plane" transform="translate(50 12)">
            <g className="story-plane-heading">
              <path
                d="m-20 3 42-19-14 39-9-14-8 7-3-11-8-2Z"
                fill="#A8D8F5"
                stroke="#052D68"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <path
                d="m-12 5 34-21L-1 9"
                fill="none"
                stroke="#052D68"
                strokeWidth="2"
              />
            </g>
          </g>
        </svg>
        {scenes.map((scene, index) => (
          <article className={`scene scene-${index + 1}`} key={index}>
            <div className="scene-copy">
              <span className="scene-number">{index + 1}</span>
              <div>
                <h3>{scene.title}</h3>
                <p>{scene.text}</p>
                <strong className="scene-note">{scene.note}</strong>
                {index === 1 && <TravelDrawing kind="ticket" />}
                {index === 2 && <div className="mobile-scene-art"><TravelDrawing kind="ride" /></div>}
              </div>
            </div>
            <div className="scene-visual">
              <SceneVisual scene={index} />
            </div>
            {index % 2 === 0 && <Cloud className="scene-cloud" />}
          </article>
        ))}
      </div>
    </section>
  );
}

export function Landing() {
  return (
    <>
      <Navigation />
      <main>
        <section className="hero">
          <Cloud className="hero-cloud left" />
          <Cloud className="hero-cloud right" />
          <div className="hero-inner">
            <div className="hero-copy">
              <h1>
                Home is
                <br />a text away.
              </h1>
              <p>
                Schedule a flight with a text.
                <br />
                Airport rides sorted. Family in the loop.
              </p>
              <div className="hero-actions">
                <SetupTrigger />
                <a className="text-link" href="#how-it-works">
                  See how it works <Icon name="arrow" />
                </a>
              </div>

            </div>
            <div className="hero-visual">
              <div className="hero-plane-trail" aria-hidden="true">
                <svg viewBox="0 0 275 150" className="hero-flight-art">
                  <path
                    d="M10 92c58 16 78-25 56-45S13 62 44 82C100 117 177 122 215.3 68.2"
                    fill="none"
                    stroke="#052D68"
                    strokeWidth="3"
                    strokeDasharray="6 9"
                    strokeLinecap="round"
                  />
                  <g transform="rotate(-10 228 28.8125)">
                    <g transform="translate(163 -24) scale(0.8125)">
                      <PlaneShape />
                    </g>
                  </g>
                </svg>
              </div>
              <Conversation hero />
              <div className="suitcase" aria-hidden="true">
                <div className="suitcase-handle" />
                <div className="suitcase-body">
                  <span />
                  <span />
                </div>
                <i />
                <i />
              </div>
            </div>
          </div>
          <CloudBank className="hero-cloud-bank" />
        </section>
        <Walkthrough />
        <FAQ />
        <section className="closing">
          <div className="closing-copy">
            <h2>Ready to head home?</h2>
            <p>Get flights, rides, and peace of mind. All over iMessage.</p>
            <SetupTrigger />
            <span>Save Wing as a contact. Say hey in Messages.</span>
          </div>
          <Plane className="closing-plane" />
          <TravelDrawing kind="home" />
          <CloudBank />
        </section>
      </main>
      <Footer />
    </>
  );
}
