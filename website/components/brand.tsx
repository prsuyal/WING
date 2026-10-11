import Link from "next/link";
import { SetupTrigger } from "./setup";
import { Plane } from "./artwork";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="Wing home">
      <Plane />
      <span>wing</span>
    </Link>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <Brand />
        <nav aria-label="Footer">
          <Link href="/#how-it-works">How it works</Link>
          <Link href="/#faq">FAQ</Link>
          <SetupTrigger className="footer-setup">Set up Wing</SetupTrigger>
        </nav>
        <p className="footer-tagline">Home is a text away.</p>
      </div>
    </footer>
  );
}
