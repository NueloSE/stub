"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useReadContract } from "wagmi";

import { ADDRESSES, POOL_ABI } from "@/lib/deployments";

const POOL = ADDRESSES.pool as `0x${string}`;

/** Sends you to the most recent draw that has a result to check. */
export default function VerifyIndex() {
  const router = useRouter();
  const { data: currentDrawId } = useReadContract({
    address: POOL,
    abi: POOL_ABI,
    functionName: "currentDrawId",
  });

  useEffect(() => {
    if (currentDrawId === undefined) return;
    const id = currentDrawId as bigint;
    router.replace(`/verify/${id > 0n ? id - 1n : 0n}`);
  }, [currentDrawId, router]);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6">
      <Link href="/" className="flex items-center gap-2 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        <span className="font-mono uppercase tracking-[0.24em]">Stub</span>
      </Link>
      <p className="mt-6 text-fg-muted">Finding the most recent draw…</p>
    </main>
  );
}
