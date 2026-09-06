import type { Metadata } from "next";

import { Landing } from "@/components/landing";

export const metadata: Metadata = {
  title: "Stub — everyone gets a stub, only you can open yours",
  description:
    "Confidential prize savings on Zama's fhEVM. Deposit, keep your principal, and the pooled yield is drawn as a prize. Everyone can check the draw; only you can read your stub.",
};

export default function Page() {
  return <Landing />;
}
