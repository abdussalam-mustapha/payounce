import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: { version: "0.8.28", settings: { evmVersion: "paris", viaIR: true, optimizer: { enabled: true, runs: 200 } } },
      production: {
        version: "0.8.28",
        settings: { evmVersion: "paris", viaIR: true, optimizer: { enabled: true, runs: 200 } },
      },
    },
  },
  networks: {
    hardhat: { type: "edr-simulated", chainType: "l1" },
    localhost: { type: "http", chainType: "l1", url: "http://127.0.0.1:8545" },
    qieTestnet: {
      type: "http",
      chainType: "l1",
      chainId: 1983,
      url: "https://rpc1testnet.qie.digital/",
      accounts: [configVariable("QIE_PRIVATE_KEY")],
    },
    qieMainnet: {
      type: "http",
      chainType: "l1",
      chainId: 1990,
      url: "https://rpc1mainnet.qie.digital/",
      accounts: [configVariable("QIE_PRIVATE_KEY")],
    },
  },
});
