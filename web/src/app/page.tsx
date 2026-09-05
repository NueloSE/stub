"use client";

import { ArrowDownToLine, ArrowUpFromLine, Droplet, Eye, Gavel, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { sepolia } from "wagmi/chains";

import { ConnectButton } from "@/components/connect";
import { StubCard, type StubState } from "@/components/stub-card";
import { Unwrap } from "@/components/unwrap";
import { Steps, type StepState } from "@/components/steps";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import {
  ADDRESSES,
  CONFIDENTIAL_USDC_ABI,
  POOL_ABI,
  USDC_ABI,
} from "@/lib/deployments";
import { EMPTY_HANDLE, encryptAmount, fetchSettlement, type EncryptedInput } from "@/lib/fhevm";
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

/**
 * Turn a failure into a sentence someone can act on.
 *
 * The custom errors matter most. Sealing and settling are permissionless, so losing a race to
 * another caller is a normal outcome rather than a fault — and reporting that as "transaction
 * reverted" makes the protocol working correctly look like the protocol breaking.
 */
function explain(error: unknown): string {
  const raw = (error as Error)?.message ?? String(error);

  if (/DrawAlreadySealed/i.test(raw))
    return "Someone else sealed this draw first — that is sealing working as intended. It can be settled now.";
  if (/DrawAlreadySettled/i.test(raw))
    return "Someone else settled this draw first. Open your stub to see how it went.";
  if (/StubAlreadyOpened/i.test(raw))
    return "This stub is already open — reveal it rather than opening it again.";
  if (/DrawNotReady/i.test(raw)) return "The draw interval has not elapsed yet.";
  if (/DrawNotSealed/i.test(raw)) return "That draw has not been sealed yet.";
  if (/DrawNotSettled/i.test(raw)) return "That draw has not been settled yet.";
  if (/DrawVoided/i.test(raw)) return "That draw was abandoned and has no result. The prize rolled into the next one.";
  if (/SettlementWindowOpen/i.test(raw)) return "A sealed draw can only be abandoned 24 hours after sealing.";
  if (/EmptyPool/i.test(raw)) return "The pool was empty at the seal, so there is nothing to draw for.";
  if (/ERC7984UnauthorizedSpender/i.test(raw)) return "The pool is not an operator on your cUSDC yet.";

  if (/user rejected|denied transaction|rejected the request/i.test(raw)) return "Cancelled in your wallet.";
  if (/timed out|timeout/i.test(raw))
    return "Timed out waiting for confirmation. The transaction may still land — check the explorer link.";
  if (/insufficient funds/i.test(raw)) return "Not enough Sepolia ETH for gas.";
  if (/chain|network/i.test(raw) && /mismatch|unsupported/i.test(raw)) return "Wrong network — switch to Sepolia.";
  if (/reverted on-chain/i.test(raw)) return raw;
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
  const [walletBalance, setWalletBalance] = useState<bigint>();
  const [prepared, setPrepared] = useState<{ kind: "deposit" | "withdraw"; amount: bigint; input: EncryptedInput }>();
  const [outcome, setOutcome] = useState<boolean>();
  const [ticket, setTicket] = useState<bigint>();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [pendingHash, setPendingHash] = useState<`0x${string}`>();
  const [awaitingWallet, setAwaitingWallet] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const wrongNetwork = isConnected && chainId !== sepolia.id;
  const parsed = parseUSDC(amount);
  /**
   * Will this deposit have to wrap, and do we actually know?
   *
   * Three cases, and the middle one is the awkward part of building on encrypted state:
   *
   *   - no cUSDC handle at all — the wallet has never held any, so a wrap is certain
   *   - a handle but no revealed balance — genuinely unknown, and guessing wrong either way
   *     costs something: wrapping needlessly spends USDC, skipping wrongly fails the deposit
   *   - a revealed balance — we know, and can skip the wrap when it already covers the deposit
   *
   * The previous version silently assumed the worst in the middle case, so whether your deposit
   * wrapped depended on whether you happened to have clicked Reveal first. Same action, different
   * transactions, for a reason nobody could see. Now the unknown is surfaced instead of guessed.
   */
  const holdsSomeCusdc = Boolean(
    wallet.confidentialHandle && wallet.confidentialHandle !== EMPTY_HANDLE,
  );
  const cusdcUnknown = holdsSomeCusdc && walletBalance === undefined;
  const needsWrap =
    parsed === undefined || !holdsSomeCusdc || walletBalance === undefined || walletBalance < parsed;
  /** Deposit needs the underlying in hand before it can wrap. Say so before the wallet does. */
  const shortfall = isConnected && needsWrap && parsed !== undefined && parsed > wallet.usdc;

  const run = useCallback(
    async (label: string, fn: () => Promise<void>) => {
      setError(undefined);
      setNotice(undefined);
      setBusy(label);
      try {
        await fn();
      } catch (e) {
        setError(explain(e));
        // Losing a race means someone else advanced the draw. Re-read rather than leaving the
        // page describing a state that is no longer true.
        await Promise.all([pool.refresh(), wallet.refetch(), handles.refetch()]).catch(() => {});
      } finally {
        setBusy(undefined);
        setAwaitingWallet(false);
      }
    },
    [pool, wallet, handles],
  );

  /**
   * Send a transaction and wait for it, reporting enough to diagnose a stall.
   *
   * Three things this does that the obvious version does not, each learned the hard way:
   * it surfaces the hash the moment the wallet returns, so a slow confirmation is visibly
   * pending rather than indistinguishable from a hang; it gives up waiting after two minutes
   * instead of spinning forever; and it treats a reverted receipt as a failure, because
   * `waitForTransactionReceipt` resolves happily for a transaction that reverted on-chain.
   */
  const send = useCallback(
    async (request: Parameters<NonNullable<typeof walletClient>["writeContract"]>[0]) => {
      if (!walletClient || !publicClient) throw new Error("Connect a wallet first.");

      setPendingHash(undefined);

      // Ask the chain first. If it already knows this will fail — a draw someone else just
      // sealed, a stub already opened — say so instead of spending a signature to find out.
      try {
        await publicClient.simulateContract(request as never);
      } catch (simulated) {
        const message = (simulated as Error)?.message ?? "";
        // Only stop for failures we recognise. An unfamiliar simulation error is more likely a
        // node quirk than a real revert, and blocking on it would be worse than trying.
        if (/Draw|Stub|EmptyPool|ERC7984|SettlementWindow/i.test(message)) throw simulated;
      }

      setAwaitingWallet(true);
      let hash: `0x${string}`;
      try {
        hash = await walletClient.writeContract(request);
      } finally {
        setAwaitingWallet(false);
      }
      setPendingHash(hash);

      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
      if (receipt.status === "reverted") {
        throw new Error(`Transaction reverted on-chain. ${hash}`);
      }
      setPendingHash(undefined);
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

  /**
   * Encrypt, and spend nothing.
   *
   * The first click has to be free and reversible. An earlier version ran the approval, the wrap
   * and the operator grant here, so by the time "Confirm deposit" appeared up to three
   * transactions had already been signed — and changing the amount afterwards discarded only the
   * proof, leaving the wrap spent and unrecoverable. Preparing now touches the chain not at all.
   *
   * Encryption is still separated from sending because it takes twelve seconds, and a wallet
   * request issued that long after a click is no longer attached to a user gesture.
   */
  const prepareDeposit = () =>
    run("encrypting", async () => {
      if (!parsed || parsed === 0n) throw new Error("Enter an amount above zero.");
      if (!decryption.client) throw new Error("The Zama SDK is still starting. Try again in a moment.");

      const input = await encryptAmount(decryption.client, POOL, address!, parsed);
      setPrepared({ kind: "deposit", amount: parsed, input });
      setNotice(
        needsWrap
          ? "Encrypted. Confirming will wrap and then deposit."
          : "Encrypted. Confirm to send it to the pool.",
      );
    });

  /**
   * Everything that costs something, on one deliberate click.
   *
   * The wallet prompts chain: each follows a transaction the user has just approved, so none of
   * them is issued from a stale gesture.
   */
  const confirmDeposit = () =>
    run("depositing", async () => {
      if (!prepared || prepared.kind !== "deposit") throw new Error("Nothing prepared.");
      const amount = prepared.amount;

      if (needsWrap) {
        if (wallet.allowance < amount) {
          setBusy("approving");
          await send({
            address: USDC, abi: USDC_ABI, functionName: "approve",
            args: [CUSDC, amount], account: address!, chain: sepolia,
          } as never);
        }

        setBusy("wrapping");
        await send({
          address: CUSDC, abi: CONFIDENTIAL_USDC_ABI, functionName: "wrap",
          args: [address!, amount], account: address!, chain: sepolia,
        } as never);
      }

      if (!wallet.isOperator) {
        setBusy("granting");
        await send({
          address: CUSDC, abi: CONFIDENTIAL_USDC_ABI, functionName: "setOperator",
          args: [POOL, OPERATOR_UNTIL], account: address!, chain: sepolia,
        } as never);
      }

      setBusy("depositing");
      await send({
        address: POOL, abi: POOL_ABI, functionName: "deposit",
        args: [prepared.input.handle, prepared.input.inputProof], account: address!, chain: sepolia,
      } as never);

      setPrepared(undefined);
      await Promise.all([wallet.refetch(), handles.refetch(), pool.refresh()]);
      setBalance(undefined);
      setWalletBalance(undefined);
      setNotice("Deposited. Your balance is encrypted on-chain — reveal it below.");
    });

  const prepareWithdraw = () =>
    run("encrypting", async () => {
      if (!parsed || parsed === 0n) throw new Error("Enter an amount above zero.");
      if (!decryption.client) throw new Error("The Zama SDK is still starting. Try again in a moment.");
      const input = await encryptAmount(decryption.client, POOL, address!, parsed);
      setPrepared({ kind: "withdraw", amount: parsed, input });
      setNotice("Encrypted. Confirm to take it out of the pool. Nothing has been sent yet.");
    });

  const confirmWithdraw = () =>
    run("withdrawing", async () => {
      if (!prepared || prepared.kind !== "withdraw") throw new Error("Nothing prepared.");
      await send({
        address: POOL, abi: POOL_ABI, functionName: "withdraw",
        args: [prepared.input.handle, prepared.input.inputProof], account: address!, chain: sepolia,
      } as never);
      setPrepared(undefined);
      await Promise.all([wallet.refetch(), handles.refetch(), pool.refresh()]);
      setBalance(undefined);
      setWalletBalance(undefined);
      setNotice("Withdrawn in full. Asking for more than you hold sends your whole balance rather than failing.");
    });

  const reveal = () =>
    run("reveal", async () => {
      const [poolHandle, walletHandle] = await Promise.all([
        publicClient!.readContract({
          address: POOL, abi: POOL_ABI, functionName: "confidentialBalanceOf", args: [address!],
        }) as Promise<string>,
        publicClient!.readContract({
          address: CUSDC, abi: CONFIDENTIAL_USDC_ABI, functionName: "confidentialBalanceOf",
          args: [address!],
        }) as Promise<string>,
      ]);
      setBalance((await decryption.readUint(POOL, poolHandle)) ?? 0n);
      setWalletBalance((await decryption.readUint(CUSDC, walletHandle)) ?? 0n);
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

      // Read the handles straight from the chain rather than from the hook. openStub has just
      // rewritten both of them, and anything captured when this callback was created still
      // points at the pre-draw values — an empty winnings handle that decrypts to zero, which
      // reads on screen as winning nothing.
      const [t, stubHandle, winningsHandle] = await Promise.all([
        publicClient!.readContract({
          address: POOL, abi: POOL_ABI, functionName: "ticketOf",
          args: [pool.openableId, address!],
        }) as Promise<bigint>,
        publicClient!.readContract({
          address: POOL, abi: POOL_ABI, functionName: "stubOf",
          args: [pool.openableId, address!],
        }) as Promise<string>,
        publicClient!.readContract({
          address: POOL, abi: POOL_ABI, functionName: "confidentialWinningsOf",
          args: [address!],
        }) as Promise<string>,
      ]);

      setTicket(t);
      setOutcome(await decryption.readBool(POOL, stubHandle));
      setWinnings(await decryption.readUint(POOL, winningsHandle));
      await handles.refetch();
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
    if (outcome === true) return (winnings ?? 0n) > 0n ? "won" : "claimed";
    if (outcome === false) return "lost";
    if (pool.openable) return "sealed";
    if (balance && balance > 0n) return "waiting";
    return "empty";
  }, [busy, outcome, winnings, pool.openable, balance]);

  /**
   * Having a handle is not the same as having a position. A full withdrawal leaves a perfectly
   * valid ciphertext of zero behind, so the handle alone would keep claiming you are in the next
   * draw after you have taken everything out. If the balance has been revealed, believe it.
   */
  const hasPosition =
    Boolean(handles.balanceHandle && handles.balanceHandle !== EMPTY_HANDLE) &&
    (balance === undefined || balance > 0n);
  const fundedEnough = !needsWrap || (parsed !== undefined && wallet.usdc >= parsed);

  const depositSteps: { label: string; hint?: string; state: StepState }[] = [
    {
      label: "Get test USDC",
      hint: needsWrap
        ? "Zama's public mint — not a faucet we wrote"
        : "Not needed — you already hold enough cUSDC",
      state: busy === "faucet" ? "busy" : fundedEnough ? "done" : "active",
    },
    {
      label: "Approve and wrap into cUSDC",
      hint: cusdcUnknown
        ? "You already hold some cUSDC — reveal your balance to avoid wrapping twice"
        : needsWrap
          ? "The wrap amount is public. Everything after it is not."
          : "Skipped — your confidential balance already covers this",
      state:
        busy === "approving" || busy === "wrapping"
          ? "busy"
          : !needsWrap
            ? "done"
            : fundedEnough
              ? "active"
              : "pending",
    },
    {
      label: "Let the pool move your cUSDC",
      hint: "One-time permission, not an amount",
      state: busy === "granting" ? "busy" : wallet.isOperator ? "done" : "active",
    },
    {
      label: "Deposit an encrypted amount",
      hint: "Encrypted in your browser, with a proof binding it to this pool",
      state:
        busy === "encrypting" || busy === "depositing"
          ? "busy"
          : hasPosition
            ? "done"
            : "active",
    },
  ];

  /** One sentence saying what to do next. Without it the draw lifecycle is guesswork. */
  const nextStep = !isConnected
    ? "Connect a wallet on Sepolia to take part."
    : wrongNetwork
      ? "Switch to Sepolia — Stub is deployed there only."
      : !hasPosition
        ? "Deposit to enter the next draw."
        : outcome !== undefined
          ? outcome
            ? (winnings ?? 0n) > 0n
              ? "You won. Claim your prize, and you are already entered in the next draw."
              : "Prize claimed. Deposit again to enter the next draw."
            : "Nothing was staked and nothing was lost. Deposit again to enter the next draw."
          : pool.openable
            ? "The draw has settled. Open your stub to see how it went."
            : sealed
              ? "The draw is sealed. Settle it to publish the seed — anyone can."
              : canSeal
                ? "The interval has elapsed. Seal the draw to start it — anyone can."
                : `Your stub is in draw #${pool.currentDrawId}. It can be sealed in ${formatCountdown(secondsToSeal)}.`;

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
            ticket={ticket ?? pool.publicTicket}
            totalAtSeal={pool.openable?.totalAtSeal}
            prize={pool.openable?.prize}
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
                {awaitingWallet
                  ? "Waiting for your wallet — check for a pending request."
                  : busy === "encrypting"
                    ? "Building a zero-knowledge proof — this takes about 12 seconds."
                    : busy === "asking the relayer"
                      ? "Asking the relayer for the decrypted seed and pool total…"
                      : pendingHash
                        ? "Waiting for confirmation on Sepolia…"
                        : `${busy}…`}
              </span>
            )}
            {pendingHash && (
              <a
                href={`https://sepolia.etherscan.io/tx/${pendingHash}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs text-accent underline-offset-4 hover:underline"
              >
                view transaction ↗
              </a>
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

          <p className="mt-4 text-sm text-fg">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">
              Next
            </span>{" "}
            {nextStep}
          </p>

          <p className="mt-2 text-xs text-fg-faint">
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
                  onChange={(e) => {
                    setAmount(e.target.value);
                    // The proof is bound to a specific amount. Changing the figure must throw it
                    // away, or confirming would send the old one.
                    if (prepared) {
                      setPrepared(undefined);
                      setNotice(undefined);
                    }
                  }}
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
                disabled={
                  !isConnected ||
                  wrongNetwork ||
                  !parsed ||
                  (prepared?.kind !== "deposit" && shortfall)
                }
                onClick={prepared?.kind === "deposit" ? confirmDeposit : prepareDeposit}
              >
                <ArrowDownToLine className="h-4 w-4" aria-hidden />
                {prepared?.kind === "deposit"
                  ? needsWrap
                    ? "Confirm — wrap and deposit"
                    : "Confirm deposit"
                  : "Deposit"}
              </Button>
            </div>

            {cusdcUnknown && !prepared && (
              <p className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
                <span>
                  You hold cUSDC already, but it is encrypted — depositing now would wrap more
                  USDC on top of it.
                </span>
                <button
                  type="button"
                  onClick={reveal}
                  className="font-medium underline underline-offset-4 hover:text-fg"
                >
                  Reveal to skip the wrap
                </button>
              </p>
            )}

            {prepared && (
              <p className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accent-faint px-3 py-2 text-xs text-fg">
                <span>
                  {formatUSDC(prepared.amount)} cUSDC encrypted and ready to{" "}
                  {prepared.kind === "deposit" ? "deposit" : "withdraw"}. Nothing has been sent yet.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setPrepared(undefined);
                    setNotice(undefined);
                  }}
                  className="text-fg-faint underline-offset-4 hover:text-fg hover:underline"
                >
                  discard
                </button>
              </p>
            )}

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

            <div className="mt-3 rounded-lg border border-ink-line bg-ink p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
                In your wallet
              </p>
              <p className="tabular mt-2 font-mono text-xl leading-none text-fg">
                {walletBalance !== undefined ? formatUSDC(walletBalance) : "▓▓▓▓▓▓"}
                {walletBalance !== undefined && (
                  <span className="ml-2 text-xs text-fg-faint">cUSDC</span>
                )}
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-fg-faint">
                Withdrawn principal and claimed prizes land here as confidential cUSDC — still
                encrypted, just no longer in the pool.
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
                variant={prepared?.kind === "withdraw" ? "primary" : "ghost"}
                loading={busy === "withdrawing" || (busy === "encrypting" && prepared?.kind !== "deposit")}
                disabled={!isConnected || wrongNetwork || !parsed}
                onClick={prepared?.kind === "withdraw" ? confirmWithdraw : prepareWithdraw}
              >
                <ArrowUpFromLine className="h-4 w-4" aria-hidden />
                {prepared?.kind === "withdraw" ? "Confirm withdrawal" : "Withdraw"}
              </Button>
            </div>

            <p className="mt-4 text-xs leading-relaxed text-fg-faint">
              Withdraw any amount at any time — this is the no-loss guarantee. Asking for more
              than you hold sends your whole balance rather than reverting, so a transaction never
              reveals what you have by failing.
            </p>

            <Unwrap
              available={walletBalance}
              onDone={() => {
                void wallet.refetch();
                setWalletBalance(undefined);
              }}
            />
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
