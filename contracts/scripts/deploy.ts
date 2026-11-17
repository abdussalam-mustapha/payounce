import { network } from "hardhat";

/**
 * Deploys PayounceFactory.
 * - qieMainnet: uses the official QIE Oracle QIE/USD feed.
 * - anything else: deploys a MockV3Aggregator first (no testnet oracle is published).
 *
 *   npx hardhat keystore set QIE_PRIVATE_KEY
 *   npm run deploy:testnet
 */
const QIE_USD_MAINNET = "0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17";
const MAX_PRICE_AGE = 24n * 60n * 60n; // the mainnet feed updates every few hours

const { viem, networkName } = await network.create();
const [deployer] = await viem.getWalletClients();
console.log(`Network: ${networkName}\nDeployer: ${deployer.account.address}`);

let oracle: `0x${string}` = QIE_USD_MAINNET;
if (networkName !== "qieMainnet") {
  const mock = await viem.deployContract("MockV3Aggregator", [8, 15_500_000n]); // $0.155
  oracle = mock.address;
  console.log(`MockV3Aggregator: ${oracle}`);
}

const implementation = await viem.deployContract("PayounceCircle", []);
console.log(`PayounceCircle (implementation): ${implementation.address}`);
// The deployer is the initial QIE ID attester; hand it to the verification service later with setAttester.
const factory = await viem.deployContract("PayounceFactory", [implementation.address, oracle, MAX_PRICE_AGE, deployer.account.address]);
console.log(`PayounceReputation: ${await factory.read.reputation()}`);
console.log(`PayounceFactory: ${factory.address}`);
console.log("Put this address in web/.env as VITE_FACTORY_ADDRESS");
