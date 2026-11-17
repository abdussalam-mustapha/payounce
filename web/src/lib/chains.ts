import { defineChain } from "viem";
import { hardhat } from "viem/chains";

export const qieMainnet = defineChain({
  id: 1990,
  name: "QIE Mainnet",
  nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc1mainnet.qie.digital/", "https://rpc5mainnet.qie.digital/"] } },
  blockExplorers: { default: { name: "QIE Explorer", url: "https://mainnet.qie.digital" } },
});

export const qieTestnet = defineChain({
  id: 1983,
  name: "QIE Testnet",
  nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc1testnet.qie.digital/"] } },
  blockExplorers: { default: { name: "QIE Testnet Explorer", url: "https://testnet.qie.digital" } },
  testnet: true,
});

const byName = { qieMainnet, qieTestnet, localhost: hardhat } as const;

export const activeChain = byName[(import.meta.env.VITE_CHAIN as keyof typeof byName) ?? "qieTestnet"] ?? qieTestnet;

export const factoryAddress = (import.meta.env.VITE_FACTORY_ADDRESS ?? "") as `0x${string}`;

export function explorerAddress(address: string) {
  const base = activeChain.blockExplorers?.default.url;
  return base ? `${base}/address/${address}` : undefined;
}
