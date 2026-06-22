import type { Metadata } from "next";
import { Landing } from "@/components/landing/Landing";

export const metadata: Metadata = {
  title: "Mnemosyne — A memory that earns your trust",
  description:
    "Mnemosyne reads what you already produced — email, calendar, contacts — and builds a memory graph that cites every claim, forgets on purpose, and interrupts you only when it should.",
};

/**
 * Public landing page. `/app/*` is the authenticated product; `/` is for the
 * world. Heavy three.js scene + post-processing — the Landing component
 * mounts it client-side, so SSR is safe.
 */
export default function LandingRoute() {
  return <Landing />;
}
