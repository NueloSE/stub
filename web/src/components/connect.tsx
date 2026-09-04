"use client";

import { AlertTriangle } from "lucide-react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { sepolia } from "wagmi/chains";

import { Button } from "@/components/ui/button";
import { shortAddress } from "@/lib/format";

export function ConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();

  if (isConnected && chainId !== sepolia.id) {
    return (
      <Button
        variant="secondary"
        loading={switching}
        onClick={() => switchChain({ chainId: sepolia.id })}
        className="border border-warn/40 text-warn"
      >
        <AlertTriangle className="h-4 w-4" aria-hidden />
        Switch to Sepolia
      </Button>
    );
  }

  if (isConnected) {
    return (
      <Button variant="secondary" onClick={() => disconnect()} className="font-mono">
        {shortAddress(address)}
      </Button>
    );
  }

  // EIP-6963 discovery gives one entry per installed wallet. Most people have exactly one.
  const injected = connectors.filter((c) => c.type === "injected" || c.id !== "injected");
  const primary = injected[0] ?? connectors[0];

  if (!primary) {
    return (
      <a
        href="https://metamask.io/download/"
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-10 items-center rounded-lg bg-ink-line px-4 text-sm text-fg hover:bg-ink-line-strong"
      >
        Install a wallet
      </a>
    );
  }

  if (injected.length > 1) {
    return (
      <div className="flex gap-2">
        {injected.slice(0, 3).map((c) => (
          <Button key={c.uid} variant="secondary" loading={isPending} onClick={() => connect({ connector: c })}>
            {c.name}
          </Button>
        ))}
      </div>
    );
  }

  return (
    <Button loading={isPending} onClick={() => connect({ connector: primary })}>
      Connect wallet
    </Button>
  );
}
