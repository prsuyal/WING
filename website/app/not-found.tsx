import Link from "next/link";
import { Brand } from "@/components/brand";
import { Plane } from "@/components/artwork";
export default function NotFound() {
  return (
    <main className="not-found">
      <Brand />
      <Plane />
      <h1>This page is unavailable.</h1>
      <p>If you’re opening a trip link, ask the traveler for a new one.</p>
      <Link className="button primary" href="/">
        Back to Wing
      </Link>
    </main>
  );
}
