"use client";

import { ArrowDownToLine, ArrowUpFromLine, Droplet, Eye, EyeOff, Gavel, Lock, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { sepolia } from "wagmi/chains";

import { ConnectButton } from "@/components/connect";
import { Chrome, Footer } from "@/components/shell";
import { StubCard, type StubState } from "@/components/stub-card";
import { Unwrap } from "@/components/unwrap";
import { Steps, type StepState } from "@/components/steps";
import { Button, ButtonLink } from "@/components/ui/button";
import { Cipher, Scramble } from "@/components/ui/cipher";
import { Panel } from "@/components/ui/panel";
import {
  ADDRESSES,
  CONFIDENTIAL_USDC_ABI,
  POOL_ABI,
  USDC_ABI,
} from "@/lib/deployments";
import { EMPTY_HANDLE, encryptAmount, fetchSettlement, type EncryptedInput } from "@/lib/fhevm";
import { formatCountdown, formatUSDC, parseUSDC, toInputValue, UNIT } from "@/lib/format";
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
  const [amount, setAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [wrapAmount, setWrapAmount] = useState("");
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

  /**
   * Banners clear themselves.
   *
   * Nothing unset these, so a confirmation from four actions ago sat on the page describing a
   * state that had long since moved on. Errors linger longer than confirmations because they are
   * more likely to need reading twice.
   */
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(undefined), 8_000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(undefined), 14_000);
    return () => clearTimeout(t);
  }, [error]);

  const wrongNetwork = isConnected && chainId !== sepolia.id;
  const parsed = parseUSDC(amount);
  const withdrawParsed = parseUSDC(withdrawAmount);
  const wrapParsed = parseUSDC(wrapAmount);
  /**
   * Wrapping is its own act now, not a step hidden inside depositing.
   *
   * It is the one operation that crosses the confidentiality boundary — the wrapped amount is
   * public — so it deserves to be a decision rather than something that happens on the way to
   * somewhere else. It also makes the two directions symmetric: unwrapping was already explicit.
   *
   * The cost is that depositing can now be asked for more cUSDC than is held, and the token
   * transfers zero rather than reverting when short. That is guarded below rather than papered
   * over by wrapping first.
   */
  const holdsSomeCusdc = Boolean(
    wallet.confidentialHandle && wallet.confidentialHandle !== EMPTY_HANDLE,
  );
  const cusdcKnown = walletBalance !== undefined;
  const notEnoughCusdc = cusdcKnown && parsed !== undefined && parsed > walletBalance;
  /**
   * No cUSDC handle at all means the wallet has never held any, which is knowable without
   * revealing anything. Depositing from a zero balance transfers zero and reports success, so
   * this has to be caught before the encryption rather than after two transactions.
   */
  const noCusdcAtAll = isConnected && !holdsSomeCusdc;
  const cusdcUnknown = holdsSomeCusdc && !cusdcKnown;

  /** Wrapping needs the underlying in hand. Say so before the wallet does. */
  const wrapShortfall = isConnected && wrapParsed !== undefined && wrapParsed > wallet.usdc;

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

  /** Turn plain USDC into confidential cUSDC. This amount is public — it is the boundary. */
  const wrapUsdc = () =>
    run("wrapping", async () => {
      if (!wrapParsed || wrapParsed === 0n) throw new Error("Enter an amount above zero.");
      if (wrapParsed > wallet.usdc) throw new Error("That is more USDC than you hold.");

      if (wallet.allowance < wrapParsed) {
        setBusy("approving");
        await send({
          address: USDC, abi: USDC_ABI, functionName: "approve",
          args: [CUSDC, wrapParsed], account: address!, chain: sepolia,
        } as never);
      }

      setBusy("wrapping");
      await send({
        address: CUSDC, abi: CONFIDENTIAL_USDC_ABI, functionName: "wrap",
        args: [address!, wrapParsed], account: address!, chain: sepolia,
      } as never);

      setWrapAmount("");
      setWalletBalance(undefined);
      await wallet.refetch();
      setNotice(`Wrapped ${formatUSDC(wrapParsed)}. That amount is public; everything after it is not.`);
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
      setNotice("Encrypted. Confirm to send it to the pool. Nothing has been sent yet.");
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
      // Wrapping happens on its own now. Depositing only ever moves cUSDC already held.
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
      setAmount("");
      await Promise.all([wallet.refetch(), handles.refetch(), pool.refresh()]);
      setBalance(undefined);
      setWalletBalance(undefined);
      setNotice("Deposited. Your balance is encrypted on-chain — reveal it below.");
    });

  const prepareWithdraw = () =>
    run("encrypting", async () => {
      if (!withdrawParsed || withdrawParsed === 0n) throw new Error("Enter an amount above zero.");
      if (!decryption.client) throw new Error("The Zama SDK is still starting. Try again in a moment.");
      const input = await encryptAmount(decryption.client, POOL, address!, withdrawParsed);
      setPrepared({ kind: "withdraw", amount: withdrawParsed, input });
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
      setWithdrawAmount("");
      await Promise.all([wallet.refetch(), handles.refetch(), pool.refresh()]);
      setBalance(undefined);
      setWalletBalance(undefined);
      setNotice("Withdrawn in full. Asking for more than you hold sends your whole balance rather than failing.");
    });

  /**
   * Each balance reveals on its own.
   *
   * One control used to open both, which was tidy while they shared a panel and confusing once
   * they did not — pressing a button on the pool card made a number appear somewhere else. Both
   * still ride the same cached permit, so splitting them costs no extra signature: the first
   * reveal of a session prompts, and nothing after it does.
   */
  const revealPool = () =>
    run("reveal-pool", async () => {
      const handle = (await publicClient!.readContract({
        address: POOL, abi: POOL_ABI, functionName: "confidentialBalanceOf", args: [address!],
      })) as string;
      setBalance((await decryption.readUint(POOL, handle)) ?? 0n);
    });

  const revealWallet = () =>
    run("reveal-wallet", async () => {
      const handle = (await publicClient!.readContract({
        address: CUSDC, abi: CONFIDENTIAL_USDC_ABI, functionName: "confidentialBalanceOf",
        args: [address!],
      })) as string;
      setWalletBalance((await decryption.readUint(CUSDC, handle)) ?? 0n);
    });

  /** The deposit panel's "reveal to skip the wrap" prompt is about the wallet balance. */
  const reveal = revealWallet;

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
  const depositSteps: { label: string; hint?: string; state: StepState }[] = [
    {
      label: "Get test USDC",
      hint: "Zama's public mint — not a faucet we wrote",
      state: busy === "faucet" ? "busy" : wallet.usdc > 0n ? "done" : "active",
    },
    {
      label: "Wrap it into cUSDC",
      hint: "This amount is public. It is the only step anyone can read.",
      state:
        busy === "approving" || busy === "wrapping"
          ? "busy"
          : holdsSomeCusdc
            ? "done"
            : wallet.usdc > 0n
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
            : `Nothing was staked and nothing was lost. Your stub for draw #${pool.currentDrawId} is already in play.`
          : pool.openable
            ? "The draw has settled. Open your stub to see how it went."
            : sealed
              ? "The draw is sealed. Settle it to publish the seed — anyone can."
              : canSeal
                ? "The interval has elapsed. Seal the draw to start it — anyone can."
                : `Your stub is in draw #${pool.currentDrawId}. It can be sealed in ${formatCountdown(secondsToSeal)}.`;

  return (
    <div className="min-h-screen">
      <Chrome
        href="/"
        actions={
          <>
            <ButtonLink href="/verify" variant="ghost" className="hidden sm:inline-flex">
              Check a draw
            </ButtonLink>
            <ConnectButton />
          </>
        }
      />

      <main id="main" tabIndex={-1} className="page-shell pt-4 sm:pt-6">
        {/*
          The stub gets its own stage. Everything else on the page is a control for it, so it
          leads — and the inset panel around it puts the one light object against the darkest
          surface available, which is the whole visual argument.
        */}
        <section className="panel-inset relative mx-auto w-full max-w-5xl p-2.5 sm:p-3.5">
          <div className="w-full">
            <StubCard
              state={stubState}
              drawId={pool.openableId ?? pool.currentDrawId}
              ticket={ticket ?? pool.publicTicket}
              totalAtSeal={pool.openable?.totalAtSeal}
              prize={pool.openable?.prize}
            />

            <div className="mt-5 flex flex-wrap items-center gap-3">
              {isConnected && pool.openable && outcome === undefined && (
                <Button
                  variant="primary"
                  size="lg"
                  loading={busy === "open" || busy === "revealing"}
                  onClick={openStub}
                >
                  <Eye className="h-4 w-4" aria-hidden />
                  {pool.alreadyOpened ? "Reveal your stub" : "Open your stub"}
                </Button>
              )}
              {isConnected && outcome === true && (winnings ?? 0n) > 0n && (
                <Button
                  variant="primary"
                  size="lg"
                  loading={busy === "claim"}
                  onClick={claim}
                >
                  <Sparkles className="h-4 w-4" aria-hidden />
                  Claim {formatUSDC(winnings)} cUSDC
                </Button>
              )}
              {busy && (
                <span className="flex items-center gap-2 text-xs text-fg-muted">
                  <span className="relative flex h-1.5 w-1.5" aria-hidden>
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
                  </span>
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
          </div>
        </section>

        {/* One sentence naming the current state of the lifecycle. */}
        <section className="panel mt-3 flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex min-w-0 items-baseline gap-2.5 text-sm text-fg">
            <span className="stat-label shrink-0 !text-accent">Next</span>
            <span className="min-w-0">{nextStep}</span>
          </p>
          <Link
            href={`/verify/${pool.openableId ?? pool.currentDrawId}`}
            className="shrink-0 text-xs text-fg-faint underline-offset-4 transition-colors hover:text-fg"
          >
            Recompute this draw yourself →
          </Link>
        </section>

        {wrongNetwork && (
          <p className="mt-3 rounded-panel border border-warn/30 bg-warn/10 px-5 py-4 text-sm text-warn">
            You&apos;re on the wrong network. Stub is deployed on Sepolia only.
          </p>
        )}
        {error && (
          <p className="mt-3 rounded-panel border border-danger/30 bg-danger/10 px-5 py-4 text-sm text-danger">
            {error}
          </p>
        )}
        {notice && !error && (
          <p className="mt-3 rounded-panel border border-won/25 bg-won-faint px-5 py-4 text-sm text-won">
            {notice}
          </p>
        )}

        {/*
          The two figures that matter, side by side and deliberately asymmetric: the prize is
          public and printed in full, the balance is a ciphertext until its owner asks. Putting
          them in matching cards makes the difference between them the only thing that varies.
        */}
        <section className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="panel p-6">
            <p className="stat-label">Prize next draw</p>
            <p className="stat-figure mt-5 text-[2.25rem] sm:text-[2.75rem]">
              {formatUSDC(pool.nextPrize)}
              <span className="ml-2 text-base font-normal text-fg-faint">cUSDC</span>
            </p>
            <p className="mt-4 text-xs leading-relaxed text-fg-faint">
              Drawn from the pooled yield. No deposit is ever spent to fund it.
            </p>
          </div>

          <div className="panel p-6">
            <div className="flex items-start justify-between gap-3">
              <p className="stat-label">Your balance in the pool</p>
              {handles.balanceHandle &&
                (balance === undefined ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-mr-1 -mt-1 shrink-0"
                    loading={busy === "reveal-pool"}
                    disabled={!isConnected || wrongNetwork}
                    onClick={revealPool}
                  >
                    <Eye className="h-3.5 w-3.5" aria-hidden />
                    {decryption.cached ? "Reveal" : "Sign to reveal"}
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-mr-1 -mt-1 shrink-0"
                    onClick={() => setBalance(undefined)}
                  >
                    <EyeOff className="h-3.5 w-3.5" aria-hidden />
                    Hide
                  </Button>
                ))}
            </div>
            {balance !== undefined ? (
              <>
                <p className="stat-figure mt-5 text-[2.25rem] sm:text-[2.75rem]">
                  <Scramble value={formatUSDC(balance)} />
                  <span className="ml-2 text-base font-normal text-fg-faint">cUSDC</span>
                </p>
                <p className="mt-4 text-xs leading-relaxed text-fg-faint">
                  Decrypted in your browser for this session. Nothing is stored — a refresh seals
                  it again.
                </p>
              </>
            ) : (
              <>
                <p className="mt-5 flex items-center gap-3 text-[2.25rem] leading-none text-fg-faint sm:text-[2.75rem]">
                  <Cipher count={4} />
                </p>
                <p className="mt-4 flex items-center gap-2 text-xs leading-relaxed text-fg-faint">
                  <Lock className="h-3 w-3 shrink-0" aria-hidden />
                  {handles.balanceHandle
                    ? "Encrypted on-chain. One signature reads it, and only for you."
                    : "No position yet — deposit to enter the next draw."}
                </p>
              </>
            )}

            {/*
              The ciphertext itself, under the figure it belongs to. It reads as noise anywhere
              else — one tester took it for a wallet address when it sat two blocks away — but
              beside the balance it is the evidence that the number really is encrypted, and it
              can be pasted into an explorer.
            */}
            {handles.balanceHandle && (
              <p className="mt-4 break-all border-t border-white/[0.06] pt-3 font-mono text-[10px] leading-relaxed text-fg-faint">
                <span className="text-fg-faint/70">ciphertext handle </span>
                {handles.balanceHandle}
              </p>
            )}
          </div>
        </section>

        {/* Lifecycle facts. Small, because they are reference rather than the point. */}
        <section className="panel mt-3 grid grid-cols-2 divide-x divide-white/[0.06]">
          {[
            { k: "Draw", v: `#${pool.currentDrawId}` },
            {
              k: sealed ? "Awaiting settlement" : "Seals in",
              v: sealed ? "sealed" : formatCountdown(secondsToSeal),
            },
          ].map((s) => (
            <div key={s.k} className="px-5 py-4">
              <dt className="stat-label">{s.k}</dt>
              <dd className="tabular mt-2 font-mono text-base text-fg">{s.v}</dd>
            </div>
          ))}
        </section>

        {/*
          Running the draw is a keeper action, not something a first-time visitor should reach
          for — their action is to deposit. It stays visible because permissionless settlement
          is a real property worth demonstrating, but it is subordinate and labelled.
        */}
        {isConnected && (canSeal || sealed) && (
          <section className="panel mt-3 flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
            <span className="stat-label">Anyone can run the draw</span>
            <span className="flex-1 text-xs text-fg-faint">
              {sealed
                ? "Sealed. Fetch the decrypted seed and total from the relayer and write them back."
                : "No operator required — sealing and settling are open to everyone."}
            </span>
            {canSeal && (
              <Button variant="secondary" size="sm" loading={busy === "seal"} onClick={seal}>
                <Gavel className="h-3.5 w-3.5" aria-hidden />
                Seal #{pool.currentDrawId.toString()}
              </Button>
            )}
            {sealed && (
              <Button
                variant="secondary"
                size="sm"
                loading={busy === "settle" || busy === "asking the relayer"}
                onClick={settle}
              >
                <Gavel className="h-3.5 w-3.5" aria-hidden />
                Settle #{pool.currentDrawId.toString()}
              </Button>
            )}
          </section>
        )}

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <Panel
            title="Get confidential USDC"
            hint="A public token has to cross into a confidential one before the pool will take it."
            bodyClassName="flex flex-col"
          >
            <Steps steps={depositSteps} />

            <div className="hairline mt-6 pt-5">
              <p className="stat-label">From plain USDC</p>
              <p className="mt-1 text-xs leading-relaxed text-fg-faint">
                Wrapping is the boundary. This amount is public; nothing after it is.
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <div className="field-surface relative flex-1">
                  <input
                    value={wrapAmount}
                    onChange={(e) => setWrapAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                    aria-label="Amount of USDC to wrap"
                    className="tabular h-11 w-full bg-transparent px-3.5 pr-16 font-mono text-sm outline-none"
                  />
                  <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-xs text-fg-faint">
                    USDC
                  </span>
                  {wallet.usdc > 0n && (
                    <button
                      type="button"
                      onClick={() => setWrapAmount(toInputValue(wallet.usdc))}
                      className="absolute right-16 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-faint hover:bg-white/[0.08] hover:text-fg"
                    >
                      max
                    </button>
                  )}
                </div>
                <Button
                  className="h-11 shrink-0"
                  variant="secondary"
                  loading={busy === "approving" || busy === "wrapping"}
                  disabled={!isConnected || wrongNetwork || !wrapParsed || wrapShortfall}
                  onClick={wrapUsdc}
                >
                  Wrap
                </Button>
              </div>
              {wrapShortfall && (
                <p className="mt-2 text-xs text-warn">
                  You hold {formatUSDC(wallet.usdc)} USDC. Mint more below, or lower the amount.
                </p>
              )}
            </div>


            <div className="hairline mt-auto flex flex-wrap items-center justify-between gap-3 pt-5">
              <span className="tabular font-mono text-xs text-fg-faint">
                {formatUSDC(wallet.usdc)} USDC in wallet
              </span>
              <Button
                variant="secondary"
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

          <Panel
            title="Your position"
            hint="Move cUSDC into the pool, back out of it, or all the way back to plain USDC."
            bodyClassName="flex flex-col"
          >
            <div className="panel-inset p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="stat-label">In your wallet, outside the pool</p>
                {wallet.confidentialHandle && wallet.confidentialHandle !== EMPTY_HANDLE && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-mr-1 -mt-1 shrink-0"
                    loading={busy === "reveal-wallet"}
                    disabled={!isConnected || wrongNetwork}
                    onClick={
                      walletBalance === undefined
                        ? revealWallet
                        : () => setWalletBalance(undefined)
                    }
                  >
                    {walletBalance === undefined ? (
                      <>
                        <Eye className="h-3.5 w-3.5" aria-hidden />
                        {decryption.cached ? "Reveal" : "Sign to reveal"}
                      </>
                    ) : (
                      <>
                        <EyeOff className="h-3.5 w-3.5" aria-hidden />
                        Hide
                      </>
                    )}
                  </Button>
                )}
              </div>
              <p className="tabular mt-2.5 font-mono text-2xl font-light leading-none text-fg">
                {walletBalance !== undefined ? (
                  <>
                    <Scramble value={formatUSDC(walletBalance)} />
                    <span className="ml-2 text-xs text-fg-faint">cUSDC</span>
                  </>
                ) : (
                  <Cipher count={4} className="text-fg-faint" />
                )}
              </p>
              <p className="mt-3 text-[11px] leading-relaxed text-fg-faint">
                Withdrawn principal and claimed prizes land here as confidential cUSDC — still
                encrypted, just no longer in the pool.
              </p>
            </div>

            <div className="hairline mt-5 pt-5">
              <p className="stat-label">Into the pool</p>
              <p className="mt-1 text-xs leading-relaxed text-fg-faint">
                Only cUSDC you already hold. Encrypted before it leaves the browser.
              </p>
            </div>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <div className="field-surface relative flex-1">
                <input
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    // The proof is bound to a specific amount. Changing the figure must throw it
                    // away, or confirming would send the old one.
                    if (prepared?.kind === "deposit") {
                      setPrepared(undefined);
                      setNotice(undefined);
                    }
                  }}
                  inputMode="decimal"
                  placeholder="100"
                  aria-label="Amount in cUSDC"
                  className="tabular h-11 w-full bg-transparent px-3.5 pr-16 font-mono text-sm outline-none"
                />
                <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-xs text-fg-faint">
                  cUSDC
                </span>
                {walletBalance !== undefined && walletBalance > 0n && (
                  <button
                    type="button"
                    onClick={() => {
                      setAmount(toInputValue(walletBalance));
                      if (prepared?.kind === "deposit") setPrepared(undefined);
                    }}
                    className="absolute right-16 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-faint hover:bg-white/[0.08] hover:text-fg"
                  >
                    max
                  </button>
                )}
              </div>
              <Button
                className="h-11 shrink-0"
                loading={["approving", "wrapping", "granting", "encrypting", "depositing"].includes(busy ?? "")}
                disabled={
                  !isConnected ||
                  wrongNetwork ||
                  !parsed ||
                  (prepared?.kind !== "deposit" && (notEnoughCusdc || noCusdcAtAll))
                }
                onClick={prepared?.kind === "deposit" ? confirmDeposit : prepareDeposit}
              >
                <ArrowDownToLine className="h-4 w-4" aria-hidden />
                {prepared?.kind === "deposit" ? "Confirm deposit" : "Deposit"}
              </Button>
            </div>


            {prepared && (
              <p className="mt-3 flex flex-wrap items-center gap-2 rounded-field border border-accent/30 bg-accent-faint px-3.5 py-2.5 text-xs leading-relaxed text-fg">
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

            {noCusdcAtAll && (
              <p className="mt-3 text-xs leading-relaxed text-warn">
                You hold no cUSDC yet. Wrap some USDC above first — the pool only accepts the
                confidential token.
              </p>
            )}

            {notEnoughCusdc && (
              <p className="mt-3 text-xs leading-relaxed text-warn">
                You hold {formatUSDC(walletBalance)} cUSDC — use max, or wrap more above. Depositing
                more than you hold moves nothing rather than failing.
              </p>
            )}

            {cusdcUnknown && !prepared && (
              <p className="mt-3 flex flex-wrap items-center gap-2 text-xs leading-relaxed text-fg-faint">
                <span>Your cUSDC balance is encrypted, so this cannot check the amount fits.</span>
                <button
                  type="button"
                  onClick={reveal}
                  className="font-medium text-warn underline underline-offset-4 hover:text-fg"
                >
                  Reveal balance
                </button>
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <div className="field-surface relative flex-1">
                <input
                  value={withdrawAmount}
                  onChange={(e) => {
                    setWithdrawAmount(e.target.value);
                    if (prepared?.kind === "withdraw") {
                      setPrepared(undefined);
                      setNotice(undefined);
                    }
                  }}
                  inputMode="decimal"
                  placeholder="0.00"
                  aria-label="Amount to withdraw from the pool"
                  className="tabular h-10 w-full bg-transparent px-3.5 pr-16 font-mono text-sm outline-none"
                />
                <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-[10px] text-fg-faint">
                  cUSDC
                </span>
                {balance !== undefined && balance > 0n && (
                  <button
                    type="button"
                    onClick={() => {
                      setWithdrawAmount(toInputValue(balance));
                      if (prepared?.kind === "withdraw") setPrepared(undefined);
                    }}
                    className="absolute right-14 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-faint hover:bg-white/[0.08] hover:text-fg"
                  >
                    max
                  </button>
                )}
              </div>
              <Button
                variant={prepared?.kind === "withdraw" ? "primary" : "secondary"}
                loading={busy === "withdrawing" || (busy === "encrypting" && prepared?.kind !== "deposit")}
                disabled={!isConnected || wrongNetwork || !withdrawParsed}
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
              className="mt-auto"
              available={walletBalance}
              onDone={() => {
                void wallet.refetch();
                setWalletBalance(undefined);
              }}
            />
          </Panel>
        </div>
      </main>

      <Footer pool={POOL} yieldSource={ADDRESSES.yieldSource} />
    </div>
  );
}
