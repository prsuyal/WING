import Link from "next/link";
import { Brand } from "./brand";
import { SetupTrigger } from "./setup";

export function Navigation() {
  return (
    <header className="navigation">
      <div className="nav-inner">
        <Brand />
        <nav aria-label="Main">
          <Link href="/#how-it-works">How it works</Link>
          <Link href="/#faq">FAQ</Link>
          <SetupTrigger className="button primary nav-cta" openFromLink />
        </nav>
      </div>
    </header>
  );
}
