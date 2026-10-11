import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SharedTrip } from "@/components/trip";
import { validToken } from "@/lib/summary";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Shared trip",
  description: "A private, read-only Wing trip summary.",
  robots: { index: false, follow: false, nocache: true },
};
export default async function Trip({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!validToken(token)) notFound();
  return <SharedTrip key={token} token={token} />;
}
