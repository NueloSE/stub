import { createPublicClient, http, parseAbiItem } from "viem";
import { sepolia } from "viem/chains";

import { ADDRESSES, CONFIDENTIAL_USDC_ABI } from "@/lib/deployments";

/**
 * Find unwraps that were burned but never finalized.
 *
 * An unwrap is two transactions. Between them the confidential balance is already gone and the
 * underlying is still held by the wrapper, reachable only by whoever completes the request. Close
 * the tab in that gap and the tokens are stranded with no prompt to recover them — so the app has
 * to go looking rather than wait to be asked.
 *
 * Run server-side because public RPCs routinely reject `eth_getLogs` from a browser origin.
 */
const UNWRAP_REQUESTED = parseAbiItem(
  "event UnwrapRequested(address indexed receiver, bytes32 indexed unwrapRequestId, bytes32 amount)",
);

const LOOKBACK_BLOCKS = 50_000n;
const CHUNK = 9_000n;

export async function GET(request: Request) {
  const user = new URL(request.url).searchParams.get("user");
  if (!user || !/^0x[a-fA-F0-9]{40}$/.test(user)) {
    return Response.json({ error: "a valid ?user address is required" }, { status: 400 });
  }

  const client = createPublicClient({
    chain: sepolia,
    transport: http(
      process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
    ),
  });

  try {
    const latest = await client.getBlockNumber();
    const floor = latest > LOOKBACK_BLOCKS ? latest - LOOKBACK_BLOCKS : 0n;

    const ids = new Set<`0x${string}`>();
    for (let to = latest; to > floor; to -= CHUNK) {
      const from = to - CHUNK + 1n > floor ? to - CHUNK + 1n : floor;
      try {
        const logs = await client.getLogs({
          address: ADDRESSES.confidentialUSDC as `0x${string}`,
          event: UNWRAP_REQUESTED,
          args: { receiver: user as `0x${string}` },
          fromBlock: from,
          toBlock: to,
        });
        for (const log of logs) {
          const id = log.args.unwrapRequestId;
          if (id) ids.add(id);
        }
      } catch {
        // Providers differ on how far back they will serve. A window we cannot read is not a
        // reason to fail the whole scan.
      }
    }

    // A request that has been finalized is deleted, so its requester reads back as the zero
    // address. Anything still pointing at someone is still owed.
    const pending: { requestId: string }[] = [];
    for (const id of ids) {
      const requester = (await client.readContract({
        address: ADDRESSES.confidentialUSDC as `0x${string}`,
        abi: CONFIDENTIAL_USDC_ABI,
        functionName: "unwrapRequester",
        args: [id],
      })) as string;
      if (requester && requester !== "0x0000000000000000000000000000000000000000") {
        pending.push({ requestId: id });
      }
    }

    return Response.json({ pending });
  } catch (e) {
    return Response.json({ error: (e as Error).message, pending: [] }, { status: 200 });
  }
}
