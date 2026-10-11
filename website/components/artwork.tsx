import { useId } from "react";
import Image from "next/image";

export function Plane({ className = "", ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      className={className}
      viewBox="0 0 160 130"
      fill="none"
      aria-hidden="true"
    >
      <PlaneShape />
    </svg>
  );
}

export function PlaneShape() {
  return (
    <>
      <path
        d="M9 49 149 7 106 113 69 79 56 110 45 65 9 49Z"
        fill="#A8D8F5"
        stroke="#052D68"
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <path
        d="m45 65 104-58-80 72-13 31"
        fill="#68B5EC"
        stroke="#052D68"
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <path
        d="m69 79 37 34L149 7 69 79Z"
        fill="#A8D8F5"
        stroke="#052D68"
        strokeWidth="5"
        strokeLinejoin="round"
      />
    </>
  );
}

export function Cloud({ className = "" }: { className?: string }) {
  const id = useId().replaceAll(":", "");
  return (
    <svg className={className} viewBox="0 0 240 120" aria-hidden="true">
      <defs>
        <linearGradient id={id} x2="0" y2="1">
          <stop stopColor="#E7F3FC" />
          <stop offset="1" stopColor="#9BD4F5" />
        </linearGradient>
      </defs>
      <path
        d="M9 97C-3 75 16 53 39 61 43 21 102 7 119 48 143 30 177 45 178 69 203 55 227 74 231 98 206 116 35 117 9 97Z"
        fill={`url(#${id})`}
      />
      <path
        d="M9 97C-3 75 16 53 39 61 43 21 102 7 119 48 143 30 177 45 178 69 203 55 227 74 231 98"
        fill="none"
        stroke="#052D68"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <path
        d="M14 102c8-17 28-24 43-13 5-32 43-47 67-13 18-8 40-2 43 15 18-8 33-1 43 15"
        fill="#B9E1F9"
        opacity=".7"
      />
    </svg>
  );
}

export function CloudBank({ className = "" }: { className?: string }) {
  return (
    <div className={`cloud-bank ${className}`} aria-hidden="true">
      <Image
        src="/images/wing_poster.png"
        alt=""
        width={853}
        height={1844}
        sizes="100vw"
        preload={className.includes("hero")}
        quality={80}
      />
      <div className="cloud-bank-fade" />
    </div>
  );
}

export function Icon({
  name,
  className = "",
}: {
  name:
    | "plane"
    | "car"
    | "clock"
    | "pin"
    | "check"
    | "info"
    | "arrow"
    | "close"
    | "copy";
  className?: string;
}) {
  const paths = {
    plane: (
      <>
        <path d="m22 2-7 20-4-9-9-4 20-7Z" />
        <path d="m11 13 11-11" />
      </>
    ),
    car: (
      <>
        <path d="m5 8 2-5h10l2 5M4 8h16l2 4v6H2v-6l2-4Z" />
        <path d="M5 18v3m14-3v3M5 12h3m8 0h3" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 3" />
      </>
    ),
    pin: (
      <>
        <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    check: <path d="m5 12 4 4L20 5" />,
    info: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 11v6m0-10v.1" />
      </>
    ),
    arrow: <path d="M3 12h18m-6-6 6 6-6 6" />,
    close: <path d="m5 5 14 14M5 19 19 5" />,
    copy: (
      <>
        <rect x="8" y="8" width="13" height="13" rx="2" />
        <path d="M16 8V3H3v13h5" />
      </>
    ),
  };
  return (
    <svg
      className={`icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export function RouteIllustration({
  from = "RDU",
  to = "EWR",
}: {
  from?: string;
  to?: string;
}) {
  return (
    <div className="route-illustration" aria-hidden="true">
      <Cloud className="route-cloud one" />
      <Cloud className="route-cloud two" />
      <svg className="route-schematic" viewBox="0 0 400 170">
        <path
          d="M36 127c70 20 101-3 93-29-11-32-50-14-39 9 20 44 78-38 137-29s54 36 119 16"
          fill="none"
          stroke="#052D68"
          strokeWidth="3"
          strokeDasharray="7 9"
          strokeLinecap="round"
        />
        <circle
          cx="36"
          cy="127"
          r="7"
          fill="#168AF0"
          stroke="#052D68"
          strokeWidth="3"
        />
        <circle
          cx="346"
          cy="94"
          r="7"
          fill="#168AF0"
          stroke="#052D68"
          strokeWidth="3"
        />
        <text
          x="36"
          y="157"
          textAnchor="middle"
          fill="#052D68"
          fontSize="23"
          fontWeight="900"
        >
          {from}
        </text>
        <text
          x="346"
          y="126"
          textAnchor="middle"
          fill="#052D68"
          fontSize="23"
          fontWeight="900"
        >
          {to}
        </text>
      </svg>
      <Plane className="route-plane" />
    </div>
  );
}

export function TravelDrawing({
  kind,
}: {
  kind: "books" | "ticket" | "ride" | "home";
}) {
  return (
    <svg
      className={`travel-drawing ${kind}`}
      viewBox="0 0 300 210"
      aria-hidden="true"
      fill="none"
      stroke="#052D68"
      strokeWidth="4"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <ellipse
        cx="153"
        cy="185"
        rx="120"
        ry="18"
        fill="#D4EDF9"
        stroke="none"
      />
      {kind === "books" && (
        <g transform="rotate(-7 150 110)">
          <rect x="56" y="137" width="182" height="40" rx="7" fill="#87C6EF" />
          <path d="M196 138h35v38h-35Z" fill="#FFFDFA" />
          <path d="M204 149h25m-25 8h25m-25 8h25" strokeWidth="2" stroke="#8FB7D0" />
          <path d="M70 143v28" stroke="#E7F3FC" />
          <text x="84" y="163" fontSize="14" fill="#052D68" stroke="none" fontWeight="900">CALCULUS</text>

          <rect x="70" y="92" width="180" height="40" rx="7" fill="#D4EDF9" />
          <path d="M207 93h35v38h-35Z" fill="#FFFDFA" />
          <path d="M215 104h25m-25 8h25m-25 8h25" strokeWidth="2" stroke="#8FB7D0" />
          <path d="M84 98v28" stroke="#87C6EF" />
          <text x="96" y="118" fontSize="13" fill="#052D68" stroke="none" fontWeight="900">CHEMISTRY</text>

          <rect x="59" y="47" width="177" height="40" rx="7" fill="#A8D8F5" />
          <path d="M193 48h35v38h-35Z" fill="#FFFDFA" />
          <path d="M201 59h25m-25 8h25m-25 8h25" strokeWidth="2" stroke="#8FB7D0" />
          <path d="M73 53v28" stroke="#E7F3FC" />
          <text x="87" y="73" fontSize="14" fill="#052D68" stroke="none" fontWeight="900">BIOLOGY</text>
          <path d="M209 49v29l-7-5-7 5V49" fill="#168AF0" strokeWidth="2" />
        </g>
      )}
      {kind === "ticket" && (
        <g transform="rotate(-12 150 105)">
          <path
            d="M35 45h230v48a12 12 0 0 0 0 24v48H35v-48a12 12 0 0 0 0-24V45Z"
            fill="#FFFDFA"
          />
          <path d="M35 45h230v30H35Z" fill="#A8D8F5" />
          <path d="M203 77v16m0 24v45" strokeWidth="2" strokeDasharray="4 6" />
          <g fill="#052D68" stroke="none" fontWeight="800">
            <text x="50" y="65" fontSize="12">BOARDING PASS</text>
            <text x="50" y="112" fontSize="25">CLT</text>
            <text x="146" y="112" fontSize="25">JFK</text>
            <text x="50" y="147" fontSize="10">THU · 1:39 PM</text>
            <text x="216" y="94" fontSize="9">GATE</text>
            <text x="216" y="111" fontSize="15">B12</text>
          </g>
          <path d="m110 100 23-8-9 22-6-8-8-6Z" fill="#87C6EF" strokeWidth="2" />
          <path d="m110 100 23-8-15 14" strokeWidth="2" />
          <path d="M50 123h135" stroke="#A8D8F5" strokeWidth="2" />
          <path d="M216 126v22m5-22v22m7-22v22m4-22v22m7-22v22m6-22v22" strokeWidth="3" strokeLinecap="butt" />
          <path d="m24 28-8-10m126 7 2-15m136 31 12-7" strokeWidth="3" />
        </g>
      )}
      {kind === "ride" && (
        <>
          <path
            d="M31 162h238M53 162V85h44v77m-34-62h10m-10 18h10m-10 18h10M214 162V75h30v87m-15-87V40m-15 2h30v20h-30Z"
            fill="#D4EDF9"
          />
          <path
            d="m80 141 20-32h87l25 32 6 14v24H73v-24l7-14Z"
            fill="#87C6EF"
          />
          <path d="m112 120-10 22h86l-14-22h-62Z" fill="#E7F3FC" />
          <path d="M81 151h23m77 0h24M120 163h42" />
          <circle cx="96" cy="179" r="13" fill="#052D68" />
          <circle cx="190" cy="179" r="13" fill="#052D68" />
          <circle cx="96" cy="179" r="6" fill="#A8D8F5" stroke="none" />
          <circle cx="190" cy="179" r="6" fill="#A8D8F5" stroke="none" />
          <path d="m112 62 33-9-10 26-9-10-6 6-3-9-5-4Z" fill="#A8D8F5" />
        </>
      )}
      {kind === "home" && (
        <>
          <path d="M63 184v-82l71-55 70 55v82H63Z" fill="#D4EDF9" />
          <path d="m47 108 87-68 87 68M180 69V40h21v48" fill="#A8D8F5" />
          <path d="M116 184v-49h36v49" fill="#FFFDFA" />
          <path
            d="M78 111h23v28H78Zm86 0h23v28h-23Zm-42-31h24v23h-24Z"
            fill="#FFF0B9"
          />
          <path
            d="M33 183v-39m0-4c-27-4-25-27-9-35-10-28 25-37 32-13 26 11 11 46-23 48Zm212 43v-51m0 5c-25-6-22-28-7-35-7-28 21-34 28-11 28 17 8 47-21 46Z"
            fill="#87C6EF"
          />
        </>
      )}
    </svg>
  );
}
