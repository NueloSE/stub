"use client";

import { AlertTriangle, Check, Copy, ExternalLink, LogOut, Wallet, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain, type Connector } from "wagmi";
import { sepolia } from "wagmi/chains";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { shortAddress } from "@/lib/format";

/** A stable identity colour per address, so an account is recognisable before it is read. */
function avatarFor(address: string) {
  const seed = parseInt(address.slice(2, 8), 16);
  const a = seed % 360;
  const b = (a + 74) % 360;
  return `conic-gradient(from ${seed % 360}deg, hsl(${a} 82% 64%), hsl(${b} 82% 54%), hsl(${a} 82% 64%))`;
}

/** EIP-6963 hands us one entry per installed wallet, and sometimes a data-URI icon with it. */
function iconOf(connector: Connector) {
  return (connector as Connector & { icon?: string }).icon;
}

function WalletDialog({
  open,
  onClose,
  connectors,
  connect,
  pendingId,
}: {
  open: boolean;
  onClose: () => void;
  connectors: readonly Connector[];
  connect: (connector: Connector) => void;
  pendingId?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog-surface"
      aria-labelledby="wallet-dialog-title"
      onClose={onClose}
      // The backdrop is part of the dialog's own box, so a click that lands on the element
      // itself rather than on its contents is a click outside the panel.
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="p-5">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 id="wallet-dialog-title" className="text-base font-medium tracking-tight text-fg">
              Connect a wallet
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-fg-faint">
              Stub never asks for a seed phrase and cannot move funds without your approval.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-full p-1.5 text-fg-faint transition-colors hover:bg-white/8 hover:text-fg"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        {connectors.length > 0 ? (
          <ul className="mt-5 space-y-1">
            {connectors.map((c) => {
              const icon = iconOf(c);
              const busy = pendingId === c.uid;
              return (
                <li key={c.uid}>
                  <button
                    type="button"
                    className="wallet-row"
                    disabled={Boolean(pendingId)}
                    onClick={() => connect(c)}
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[10px] border border-white/10 bg-white/5">
                      {icon ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={icon} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Wallet className="h-4 w-4 text-fg-muted" aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">{c.name}</span>
                      <span className="block text-[11px] text-fg-faint">
                        {busy ? "Check your wallet…" : "Detected in this browser"}
                      </span>
                    </span>
                    {busy && (
                      <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="mt-5 rounded-field border border-white/10 bg-white/[0.03] p-4">
            <p className="text-sm text-fg">No wallet detected in this browser.</p>
            <p className="mt-1.5 text-xs leading-relaxed text-fg-faint">
              Stub needs a browser wallet on Sepolia. Install one, then reload this page.
            </p>
            <a
              href="https://metamask.io/download/"
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-xs text-accent underline-offset-4 hover:underline"
            >
              Install MetaMask
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </div>
        )}

        <p className="hairline mt-5 pt-4 text-[11px] leading-relaxed text-fg-faint">
          Sepolia testnet only. The tokens here are worthless and the faucet is Zama&apos;s public
          mint.
        </p>
      </div>
    </dialog>
  );
}

/** The connected state: identity, the address in full, and the two things you might want to do. */
function AccountMenu({ address, onDisconnect }: { address: `0x${string}`; onDisconnect: () => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be refused; the address is shown in full above regardless.
    }
  }, [address]);

  return (
    <div ref={wrap} className="relative">
      <Button
        variant="secondary"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        className="gap-2.5 pl-2"
      >
        <span
          aria-hidden
          className="h-5 w-5 shrink-0 rounded-full ring-1 ring-white/20"
          style={{ background: avatarFor(address) }}
        />
        <span className="font-mono text-xs">{shortAddress(address)}</span>
      </Button>

      {open && (
        <div
          aria-label="Account"
          className="panel absolute right-0 top-[calc(100%+0.5rem)] z-50 w-64 p-2"
        >
          <div className="px-2 py-2">
            <p className="stat-label">Connected</p>
            <p className="mt-1.5 break-all font-mono text-[11px] leading-relaxed text-fg-muted">
              {address}
            </p>
          </div>
          <div className="hairline mt-1 pt-1">
            <button type="button" className="wallet-row gap-2.5 text-sm" onClick={copy}>
              {copied ? (
                <Check className="h-4 w-4 shrink-0 text-won" aria-hidden />
              ) : (
                <Copy className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
              )}
              {copied ? "Address copied" : "Copy address"}
            </button>
            <a
              href={`https://sepolia.etherscan.io/address/${address}`}
              target="_blank"
              rel="noreferrer"
              className="wallet-row gap-2.5 text-sm"
            >
              <ExternalLink className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
              View on Etherscan
            </a>
            <button
              type="button"
              className={cn("wallet-row gap-2.5 text-sm text-danger")}
              onClick={() => {
                setOpen(false);
                onDisconnect();
              }}
            >
              <LogOut className="h-4 w-4 shrink-0" aria-hidden />
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending, variables } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const [open, setOpen] = useState(false);

  // wagmi types the in-flight connector as `Connector | CreateConnectorFn`; only the former
  // carries a uid, so narrow before using it to mark a row as busy.
  const inFlight = variables?.connector;
  const pendingId =
    isPending && inFlight && typeof inFlight === "object" && "uid" in inFlight
      ? inFlight.uid
      : undefined;

  // Once a connection lands there is nothing left to choose, so the dialog gets out of the way.
  useEffect(() => {
    if (isConnected) setOpen(false);
  }, [isConnected]);

  if (isConnected && chainId !== sepolia.id) {
    return (
      <Button
        variant="secondary"
        loading={switching}
        onClick={() => switchChain({ chainId: sepolia.id })}
        className="border-warn/40 text-warn"
      >
        <AlertTriangle className="h-4 w-4" aria-hidden />
        Switch to Sepolia
      </Button>
    );
  }

  if (isConnected && address) {
    return <AccountMenu address={address} onDisconnect={() => disconnect()} />;
  }

  return (
    <>
      <Button loading={isPending && !open} onClick={() => setOpen(true)}>
        Connect wallet
      </Button>
      <WalletDialog
        open={open}
        onClose={() => setOpen(false)}
        connectors={connectors}
        connect={(connector) => connect({ connector })}
        pendingId={pendingId}
      />
    </>
  );
}
