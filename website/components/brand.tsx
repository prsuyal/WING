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

export function Footer({ privateTrip = false }: { privateTrip?: boolean }) {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <Brand />
        <nav aria-label="Footer">
          <Link href="/#how-it-works">How it works</Link>
          <Link href="/#faq">FAQ</Link>
          <SetupTrigger className="footer-setup">Set up Wing</SetupTrigger>
        </nav>
        <p className={privateTrip ? undefined : "footer-tagline"}>
          {privateTrip ? (
            <>
              Read-only trip link.
              <br />
              Anyone with this active link can view these trip details.
            </>
          ) : (
            <>
              Home is a text away.

            </>
          )}
        </p>
      </div>
    </footer>
  );
}
