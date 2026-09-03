import { createConfig, fallback, http } from "wagmi";
import { sepolia } from "wagmi/chains";

/**
 * Sepolia only. Stub is deployed on one chain and writing to another would be a bug, not a
 * feature — so there is nothing to switch to and no chain picker to get wrong.
 *
 * Connectors come from EIP-6963 discovery (default in wagmi v3), so MetaMask, Rabby and the
 * rest announce themselves without importing the connectors barrel and its optional deps.
 */
export const wagmiConfig = createConfig({
  chains: [sepolia],
  multiInjectedProviderDiscovery: true,
  transports: {
    [sepolia.id]: fallback([
      http(process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL),
      http("https://ethereum-sepolia-rpc.publicnode.com"),
      http("https://11155111.rpc.thirdweb.com"),
      http(),
    ]),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
