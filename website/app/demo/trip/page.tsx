import type { Metadata } from "next";
import { SampleTrip } from "@/components/trip";
export const metadata: Metadata = {
  title: "Sample Trip",
  description:
    "A Wing trip summary with flight details, airport rides, and journey updates.",
};
export default function DemoTrip() {
  return <SampleTrip />;
}
