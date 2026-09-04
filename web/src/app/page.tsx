"use client";

import { ArrowDownToLine, ArrowUpFromLine, Droplet, Eye, Gavel, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { sepolia } from "wagmi/chains";

import { ConnectButton } from "@/components/connect";
import { StubCard, type StubState } from "@/components/stub-card";
import { Steps, type StepState } from "@/components/steps";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import {
  ADDRESSES,
  CONFIDENTIAL_USDC_ABI,
  POOL_ABI,
  USDC_ABI,
} from "@/lib/deployments";
import { encryptAmount, fetchSettlement } from "@/lib/fhevm";
import { formatCountdown, formatUSDC, parseUSDC, UNIT } from "@/lib/format";
import {
  OPERATOR_UNTIL,
  useDecryption,
  useEncryptedHandles,
  usePoolState,
  useWalletState,
} from "@/lib/pool";

const POOL = ADDRESSES.pool as `0x${string}`;
const CUSDC = ADDRESSES.confidentialUSDC as `0x${string}`;
const USDC = ADDRESSES.usdc as `0x${string}`;
const FAUCET_AMOUNT = 1_000n * UNIT;

/** Human-readable reasons for the failures this app can actually hit. */
function explain(error: unknown): string {
  const raw = (error as Error)?.message ?? String(error);
  if (/user rejected|denied transaction|rejected the request/i.test(raw)) return "Cancelled in your wallet.";
  if (/insufficient funds/i.test(raw)) return "Not enough Sepolia ETH for gas.";
  if (/DrawNotReady/i.test(raw)) return "The draw interval has not elapsed yet.";
  if (/DrawNotSettled/i.test(raw)) return "That draw has not been settled yet.";
  if (/StubAlreadyOpened/i.test(raw)) return "This stub has already been opened.";
  if (/EmptyPool/i.test(raw)) return "The pool was empty at the seal, so there is nothing to draw for.";
  if (/ERC7984UnauthorizedSpender/i.test(raw)) return "The pool is not an operator on your cUSDC yet.";
  if (/chain|network/i.test(raw) && /mismatch|unsupported/i.test(raw)) return "Wrong network — switch to Sepolia.";
  return raw.split("\n")[0].slice(0, 160);
}

export default function Home() {
  const { address, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const pool = usePoolState();
  const wallet = useWalletState();
  const handles = useEncryptedHandles();
  const decryption = useDecryption();

  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [amount, setAmount] = useState("100");
  const [balance, setBalance] = useState<bigint>();
  const [winnings, setWinnings] = useState<bigint>();
  const [outcome, setOutcome] = useState<boolean>();
  const [ticket, setTicket] = useState<bigint>();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const wrongNetwork = isConnected && chainId !== sepolia.id;
  const parsed = parseUSDC(amount);
  /** Deposit needs the underlying in hand before it can wrap. Say so before the wallet does. */
  const shortfall = isConnected && parsed !== undefined && parsed > wallet.usdc;

  const run = useCallback(
    async (label: string, fn: () => Promise<void>) => {
      setError(undefined);
      setNotice(undefined);
      setBusy(label);
      try {
        await fn();
      } catch (e) {
        setError(explain(e));
      } finally {
        setBusy(undefined);
      }
    },
    [],
  );

  const send = useCallback(
    async (request: Parameters<NonNullable<typeof walletClient>["writeContract"]>[0]) => {
      if (!walletClient || !publicClient) throw new Error("Connect a wallet first.");
      const hash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      return hash;
    },
    [walletClient, publicClient],
  );

  // ---- actions -------------------------------------------------------------------------

  const getTestUSDC = () =>
    run("faucet", async () => {
      await send({
        address: USDC,
        abi: USDC_ABI,
        functionName: "mint",
        args: [address!, FAUCET_AMOUNT],
        account: address!,
        chain: sepolia,
      } as never);
      await wallet.refetch();
      setNotice("1,000 test USDC minted from Zama's public faucet.");
    });

  const deposit = () =>
    run("deposit", async () => {
      if (!parsed || parsed === 0n) throw new Error("Enter an amount above zero.");
      if (!decryption.client) throw new Error("The Zama SDK is still starting. Try again in a moment.");

      // 1. Approve the wrapper to take the underlying.
      if (wallet.allowance < parsed) {
        setBusy("approving");
        await send({
          address: USDC, abi: USDC_ABI, functionName: "approve",
          args: [CUSDC, parsed], account: address!, chain: sepolia,
        } as never);
      }

      // 2. Wrap. This amount is public — the confidentiality boundary sits here.
      setBusy("wrapping");
      await send({
        address: CUSDC, abi: CONFIDENTIAL_USDC_ABI, functionName: "wrap",
        args: [address!, parsed], account: address!, chain: sepolia,
      } as never);

      // 3. Let the pool move cUSDC on your behalf. A permission, not an amount.
      if (!wallet.isOperator) {
        setBusy("granting");
        await send({
          address: CUSDC, abi: CONFIDENTIAL_USDC_ABI, functionName: "setOperator",
          args: [POOL, OPERATOR_UNTIL], account: address!, chain: sepolia,
        } as never);
      }

      // 4. Encrypt in the browser. Slow on purpose — it is a real ZK proof.
      setBusy("encrypting");
      const encrypted = await encryptAmount(decryption.client, POOL, address!, parsed);

      setBusy("depositing");
      await send({
        address: POOL, abi: POOL_ABI, functionName: "deposit",
        args: [encrypted.handle, encrypted.inputProof], account: address!, chain: sepolia,
      } as never);

      await Promise.all([wallet.refetch(), handles.refetch(), pool.refresh()]);
      setBalance(undefined);
      setNotice("Deposited. Your balance is encrypted on-chain — reveal it below.");
    });

  const withdraw = () =>
    run("withdraw", async () => {
      if (!parsed || parsed === 0n) throw new Error("Enter an amount above zero.");
      if (!decryption.client) throw new Error("The Zama SDK is still starting. Try again in a moment.");

      setBusy("encrypting");
      const encrypted = await encryptAmount(decryption.client, POOL, address!, parsed);

      setBusy("withdrawing");
      await send({
        address: POOL, abi: POOL_ABI, functionName: "withdraw",
        args: [encrypted.handle, encrypted.inputProof], account: address!, chain: sepolia,
      } as never);

      await Promise.all([wallet.refetch(), handles.refetch(), pool.refresh()]);
      setBalance(undefined);
      setNotice("Withdrawn in full. Asking for more than you hold sends your whole balance rather than failing.");
    });

  const reveal = () =>
    run("reveal", async () => {
      const value = await decryption.readUint(POOL, handles.balanceHandle);
      setBalance(value ?? 0n);
    });

  const seal = () =>
    run("seal", async () => {
      await send({
        address: POOL, abi: POOL_ABI, functionName: "sealDraw",
        args: [], account: address!, chain: sepolia,
      } as never);
      await pool.refresh();
      setNotice("Sealed. The protocol generated a seed nobody knew in advance — now settle it.");
    });

  const settle = () =>
    run("settle", async () => {
      if (!decryption.client || !pool.current) throw new Error("Nothing to settle.");
      setBusy("asking the relayer");
      const { cleartexts, proof } = await fetchSettlement(
        decryption.client,
        pool.current.seedHandle,
        pool.current.totalHandle,
      );
      setBusy("settling");
      await send({
        address: POOL, abi: POOL_ABI, functionName: "settleDraw",
        args: [cleartexts, proof], account: address!, chain: sepolia,
      } as never);
      await pool.refresh();
      setNotice("Settled under a KMS proof. Every ticket is now recomputable by anyone.");
    });

  const openStub = () =>
    run("open", async () => {
      if (pool.openableId === undefined) throw new Error("No settled draw to open.");
      if (!pool.alreadyOpened) {
        await send({
          address: POOL, abi: POOL_ABI, functionName: "openStub",
          args: [pool.openableId, address!], account: address!, chain: sepolia,
        } as never);
        await pool.refresh();
      }
      setBusy("revealing");
      const [t, won, w] = await Promise.all([
        publicClient!.readContract({
          address: POOL, abi: POOL_ABI, functionName: "ticketOf",
          args: [pool.openableId, address!],
        }) as Promise<bigint>,
        publicClient!
          .readContract({
            address: POOL, abi: POOL_ABI, functionName: "stubOf",
            args: [pool.openableId, address!],
          })
          .then((h) => decryption.readBool(POOL, h as string)),
        handles.refetch().then(() => undefined),
      ]);
      setTicket(t);
      setOutcome(won);
      const owed = await decryption.readUint(POOL, handles.winningsHandle);
      setWinnings(owed);
    });

  const claim = () =>
    run("claim", async () => {
      await send({
        address: POOL, abi: POOL_ABI, functionName: "claim",
        args: [], account: address!, chain: sepolia,
      } as never);
      await handles.refetch();
      setWinnings(0n);
      setNotice("Claimed. This transaction costs the same whether or not you won.");
    });

  // ---- derived -------------------------------------------------------------------------

  const secondsToSeal = Number(pool.sealableAt) - now;
  const sealed = pool.current?.isSealed && !pool.current?.isSettled;
  const canSeal = !sealed && secondsToSeal <= 0;

  const stubState: StubState = useMemo(() => {
    if (busy === "open") return "opening";
    if (busy === "revealing") return "revealing";
    if (outcome === true) return "won";
    if (outcome === false) return "lost";
    if (pool.openable) return "sealed";
    if (balance && balance > 0n) return "waiting";
    return "empty";
  }, [busy, outcome, pool.openable, balance]);

  const depositSteps: { label: string; hint?: string; state: StepState }[] = [
    {
      label: "Get test USDC",
      hint: "Zama's public mint — not a faucet we wrote",
      state:
        busy === "faucet"
          ? "busy"
          : parsed !== undefined && wallet.usdc >= parsed
            ? "done"
            : "active",
    },
    {
      label: "Approve and wrap into cUSDC",
      hint: "The wrap amount is public. Everything after it is not.",
      state:
        busy === "approving" || busy === "wrapping"
          ? "busy"
          : parsed !== undefined && wallet.usdc >= parsed
            ? "active"
            : "pending",
    },
    {
      label: "Let the pool move your cUSDC",
      hint: "A permission, not an amount",
      state: wallet.isOperator ? "done" : busy === "granting" ? "busy" : "pending",
    },
    {
      label: "Deposit an encrypted amount",
      hint: "Encrypted in your browser, with a proof binding it to this pool",
      state: busy === "encrypting" || busy === "depositing" ? "busy" : "pending",
    },
  ];

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-sm uppercase tracking-[0.24em] text-fg">Stub</span>
          <span className="hidden text-xs text-fg-faint sm:inline">confidential prize savings</span>
        </div>
        <ConnectButton />
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-24">
        <section className="pt-6 sm:pt-10">
          <h1 className="max-w-[18ch] text-4xl font-medium leading-[1.05] tracking-tight text-fg sm:text-5xl">
            Everyone gets a stub. Only you can open yours.
          </h1>
          <p className="mt-4 max-w-xl text-fg-muted">
            Deposit, keep your principal, and the pooled yield is drawn as a prize.
          </p>

        </section>

        <section className="mt-8">
          <StubCard
            state={stubState}
            drawId={pool.openableId ?? pool.currentDrawId}
            ticket={ticket}
            totalAtSeal={pool.openable?.totalAtSeal}
            prize={winnings ?? pool.openable?.prize}
          />

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {isConnected && pool.openable && outcome === undefined && (
              <Button loading={busy === "open" || busy === "revealing"} onClick={openStub}>
                <Eye className="h-4 w-4" aria-hidden />
                {pool.alreadyOpened ? "Reveal your stub" : "Open your stub"}
              </Button>
            )}
            {isConnected && outcome === true && (winnings ?? 0n) > 0n && (
              <Button variant="paper" loading={busy === "claim"} onClick={claim}>
                <Sparkles className="h-4 w-4" aria-hidden />
                Claim {formatUSDC(winnings)} cUSDC
              </Button>
            )}
            {busy && (
              <span className="text-xs text-fg-faint">
                {busy === "encrypting"
                  ? "Building a zero-knowledge proof — this takes about 12 seconds."
                  : busy === "asking the relayer"
                    ? "Asking the relayer for the decrypted seed and pool total…"
                    : `${busy}…`}
              </span>
            )}
          </div>

          {/*
            Running the draw is a keeper action, not something a first-time visitor should reach
            for — their action is to deposit. It stays visible because permissionless settlement
            is a real property worth demonstrating, but it is subordinate and labelled.
          */}
          {isConnected && (canSeal || sealed) && (
            <div className="mt-5 flex flex-wrap items-center gap-3 rounded-lg border border-ink-line bg-ink-raised px-4 py-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
                Anyone can run the draw
              </span>
              {canSeal && (
                <Button variant="ghost" size="sm" loading={busy === "seal"} onClick={seal}>
                  <Gavel className="h-3.5 w-3.5" aria-hidden />
                  Seal #{pool.currentDrawId.toString()}
                </Button>
              )}
              {sealed && (
                <Button
                  variant="ghost"
                  size="sm"
                  loading={busy === "settle" || busy === "asking the relayer"}
                  onClick={settle}
                >
                  <Gavel className="h-3.5 w-3.5" aria-hidden />
                  Settle #{pool.currentDrawId.toString()}
                </Button>
              )}
              <span className="text-xs text-fg-faint">
                {sealed
                  ? "Sealed. Fetch the decrypted seed and total from the relayer and write them back."
                  : "No operator required — sealing and settling are open to everyone."}
              </span>
            </div>
          )}

          <p className="mt-4 text-xs text-fg-faint">
            Not taking anyone&apos;s word for it?{" "}
            <Link
              href={`/verify/${pool.openableId ?? pool.currentDrawId}`}
              className="text-accent underline-offset-4 hover:underline"
            >
              Recompute this draw yourself
            </Link>{" "}
            — no wallet needed.
          </p>
        </section>

        {wrongNetwork && (
          <p className="mt-6 rounded-lg border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn">
            You&apos;re on the wrong network. Stub is deployed on Sepolia only.
          </p>
        )}
        {error && (
          <p className="mt-6 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}
        {notice && !error && (
          <p className="mt-6 rounded-lg border border-won/25 bg-won-faint px-4 py-3 text-sm text-won">
            {notice}
          </p>
        )}


        <section className="mt-8">
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-ink-line bg-ink-line sm:grid-cols-4">
            {[
              { k: "Prize next draw", v: `${formatUSDC(pool.nextPrize)}`, u: "cUSDC" },
              {
                k: sealed ? "Awaiting settlement" : "Next draw",
                v: sealed ? "sealed" : formatCountdown(secondsToSeal),
                u: "",
              },
              { k: "Draw", v: `#${pool.currentDrawId}`, u: "" },
              { k: "Your balance", v: balance !== undefined ? formatUSDC(balance) : "sealed", u: balance !== undefined ? "cUSDC" : "" },
            ].map((s) => (
              <div key={s.k} className="bg-ink-raised px-4 py-4">
                <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
                  {s.k}
                </dt>
                <dd className="tabular mt-1.5 font-mono text-lg text-fg">
                  {s.v} {s.u && <span className="text-xs text-fg-faint">{s.u}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <Panel title="Deposit" hint="A public token has to cross into a confidential one first.">
            <Steps steps={depositSteps} />

            <div className="mt-5 flex gap-2">
              <div className="relative flex-1">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="100"
                  aria-label="Amount in cUSDC"
                  className="tabular h-10 w-full rounded-lg border border-ink-line bg-ink px-3 pr-16 font-mono text-sm text-fg outline-none focus:border-accent"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-fg-faint">
                  cUSDC
                </span>
              </div>
              <Button
                loading={["approving", "wrapping", "granting", "encrypting", "depositing"].includes(busy ?? "")}
                disabled={!isConnected || wrongNetwork || !parsed || shortfall}
                onClick={deposit}
              >
                <ArrowDownToLine className="h-4 w-4" aria-hidden />
                Deposit
              </Button>
            </div>

            {shortfall && (
              <p className="mt-3 text-xs text-warn">
                {wallet.usdc === 0n
                  ? "You have no test USDC yet — mint some below."
                  : `You hold ${formatUSDC(wallet.usdc)} USDC and are trying to deposit ${formatUSDC(parsed)}. Mint more below, or lower the amount.`}
              </p>
            )}

            <div className="mt-4 flex items-center justify-between border-t border-ink-line pt-4">
              <span className="tabular font-mono text-xs text-fg-faint">
                {formatUSDC(wallet.usdc)} USDC in wallet
              </span>
              <Button
                variant="ghost"
                size="sm"
                loading={busy === "faucet"}
                disabled={!isConnected || wrongNetwork}
                onClick={getTestUSDC}
              >
                <Droplet className="h-3.5 w-3.5" aria-hidden />
                Get 1,000 test USDC
              </Button>
            </div>
          </Panel>

          <Panel title="Your position" hint="Encrypted on-chain. One signature opens it for the session.">
            <div className="rounded-lg border border-ink-line bg-ink p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
                Pool balance
              </p>
              <p className="tabular mt-2 font-mono text-3xl leading-none text-fg">
                {balance !== undefined ? formatUSDC(balance) : "▓▓▓▓▓▓"}
                {balance !== undefined && <span className="ml-2 text-sm text-fg-faint">cUSDC</span>}
              </p>
              <p className="mt-3 break-all font-mono text-[10px] text-fg-faint">
                {handles.balanceHandle ?? "no position yet"}
              </p>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                loading={busy === "reveal"}
                disabled={!isConnected || wrongNetwork || !handles.balanceHandle}
                onClick={reveal}
              >
                <Eye className="h-4 w-4" aria-hidden />
                {decryption.cached ? "Reveal" : "Sign to reveal"}
              </Button>
              <Button
                variant="ghost"
                loading={busy === "withdraw" || busy === "withdrawing"}
                disabled={!isConnected || wrongNetwork || !parsed}
                onClick={withdraw}
              >
                <ArrowUpFromLine className="h-4 w-4" aria-hidden />
                Withdraw
              </Button>
            </div>

            <p className="mt-4 text-xs leading-relaxed text-fg-faint">
              Withdraw any amount at any time — this is the no-loss guarantee. Asking for more
              than you hold sends your whole balance rather than reverting, so a transaction never
              reveals what you have by failing.
            </p>
          </Panel>
        </div>

        <footer className="mt-14 border-t border-ink-line pt-6 text-xs text-fg-faint">
          <p className="max-w-2xl leading-relaxed">
            Sepolia. Yield is simulated by an admin-funded reserve — no real return is generated.
            The confidential token is Zama&apos;s own <span className="font-mono">cUSDCMock</span>;
            Stub deploys no token of its own.
          </p>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono">
            <a className="hover:text-fg" href={`https://sepolia.etherscan.io/address/${POOL}#code`} target="_blank" rel="noreferrer">
              pool ↗
            </a>
            <a className="hover:text-fg" href={`https://sepolia.etherscan.io/address/${ADDRESSES.yieldSource}#code`} target="_blank" rel="noreferrer">
              yield source ↗
            </a>
            <Link className="hover:text-fg" href="/verify">
              check a draw
            </Link>
            <a className="hover:text-fg" href="https://github.com/NueloSE/stub" target="_blank" rel="noreferrer">
              source ↗
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}
