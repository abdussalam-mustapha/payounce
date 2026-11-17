import { createConfig, http, type Transport } from "wagmi";
import { injected, mock } from "wagmi/connectors";
import { activeChain } from "./chains";

/**
 * Development only: with VITE_CHAIN=localhost and VITE_DEV_ACCOUNT set, a mock wallet auto-connects
 * as that Hardhat account (the local node signs for its unlocked accounts). Never active in builds.
 */
export const devAccount =
  import.meta.env.DEV && import.meta.env.VITE_CHAIN === "localhost"
    ? (import.meta.env.VITE_DEV_ACCOUNT as `0x${string}` | undefined)
    : undefined;

// EIP-6963 discovery is on by default, so QIE Wallet (rdns "me.qiewallet"),
// MetaMask, Keplr etc. show up as separate connectors automatically.
export const config = createConfig({
  chains: [activeChain],
  connectors: devAccount ? [mock({ accounts: [devAccount], features: { reconnect: true } }), injected()] : [injected()],
  transports: { [activeChain.id]: http() } as Record<typeof activeChain.id, Transport>,
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
