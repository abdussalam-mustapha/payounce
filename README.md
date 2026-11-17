# Payounce

**The savings circle, made trustless.** On the QIE blockchain.

Hundreds of millions of people save in rotating savings circles, known as tandas in Mexico, chit funds in
India, paluwagan in the Philippines, hui and kye in China and Korea, susu in the Caribbean and West Africa,
chamas in Kenya, and lending circles among immigrant families in the US and Europe. A group pays in every
round and one member takes the pot. It runs on trust, and it breaks the same way everywhere: someone collects
early and stops paying. It also only works between people who live near each other.

Payounce makes the trust enforceable and borderless: collateral covers missed payments, the contract pays out
automatically, and circles can be priced in USD so a family split across Lagos, London and Houston can save
together.

## How it works

**Seat-based collateral.** Seats are not equal: seat 1 collects the pot first and still owes every
remaining round, while the last seat is pure saving. So each seat locks exactly what it would still owe
after its payout:

| Seat (5 members, $100/round) | Paid out | Locks |
|---|---|---|
| 1 | round 1 | $400 |
| 2 | round 2 | $300 |
| 3 | round 3 | $200 |
| 4 | round 4 | $100 |
| 5 | round 5 | nothing |

Nobody can collect the pot and leave the group short. Need money soon? Take an early seat. Saving? Take
a late one and lock nothing.

**Portable track record.** Every circle reports each member's on-time payments, misses, completions and
defaults to `PayounceReputation`. Circles that opt in let a clean record cut early-seat collateral by 25%
per finished circle (max 50%). Any default removes the discount. Savings with people you know become a
credit history you can carry anywhere.

**Seat premium (optional).** Early seats are effectively a loan from later seats. The creator can set a
premium of 1–20% of a contribution per seat-step; early seats give it from their payout, and the pool is
shared among later seats by position when the circle ends. Savers earn, people who need cash early pay a
fair price, and nobody sets an interest rate (the same idea as India's auctioned chit funds).

**Flexibility that real circles need.**
- *Pay ahead*: prefund rounds; they pay automatically at settlement and count as on time.
- *Seat swaps*: two members trade seats by mutual consent; collateral rebalances automatically.
- *Hardship grace*: a member can ask the group to forgive one missed round; with a majority it is covered
  from collateral and kept off their record. Once per member per circle.
- *Calendar reminders*: every member can add all payment deadlines and their payout date to any calendar.

**Savings passport.** `/u/<address>` shows a member's on-chain record: on-time rate, circles finished,
graces, defaults and every circle joined. Circles can require QIE ID-verified members.

**Defaults.** A missed payment is taken from the member's collateral. A member who runs out before their
payout loses their turn and is refunded what they paid in minus 10%; the rest of their turn's pot is shared
among the members who kept paying.

Built for QIE Hackathon 3.0 (DeFi & Financial Infrastructure track).

## Security
- Every money path is covered by Solidity unit tests, plus invariant tests that run random sequences of
  every action (joins, payments, prefunds, swaps, grace votes, settlements, withdrawals, price moves) and
  check that the circle always holds exactly what it owes and that seats and members stay consistent.
- Circles are EIP-1167 clones of one shared implementation (not externally audited); the implementation and every clone
  can only be initialised once. Payouts use pull withdrawals behind a reentrancy guard.

## QIE integrations
- **QIE Oracle**: circles can be priced in USD; contributions are converted to QIE at the live
  QIE/USD price (`0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17`, 8 decimals) with a staleness check.
- **QIE ID**: `PayounceReputation` has an attester role that marks wallets as verified; circles can admit
  verified members only. The attester should be a small service that checks a member's QIE ID before calling
  `setVerified` (QIE has not published an on-chain QIE ID interface yet). The deployer is the initial attester.
- **QIE Wallet**: discovered automatically through EIP-6963 and listed first in the connect menu.
- **ERC-20 circles**: pass a stablecoin address (e.g. QIE's stablecoin) to save in a stable asset.

## Layout
```
contracts/   Hardhat 3, Solidity 0.8.28 (evm: paris), Solidity tests
web/         Vite + React + TypeScript + wagmi 3 + viem
```

## Setup
Requires Node 22.13+ (`nvm use`, see `.nvmrc`).

```bash
cd contracts && npm install
npm test                       # Solidity tests
npm run abi                    # compile + export ABIs to web/src/lib/abi.ts

cd ../web && npm install
cp .env.example .env           # set VITE_CHAIN and VITE_FACTORY_ADDRESS
npm run dev
```

### Local chain
```bash
cd contracts
npm run node                   # terminal 1
npm run deploy:local           # terminal 2 -> prints the factory address
# web/.env: VITE_CHAIN=localhost, VITE_FACTORY_ADDRESS=<printed address>
```

### QIE testnet / mainnet
```bash
cd contracts
npx hardhat keystore set QIE_PRIVATE_KEY   # stored encrypted, never in git
npm run deploy:testnet         # chain 1983; deploys a mock oracle (no testnet feed is published)
npm run deploy:mainnet         # chain 1990; uses the real QIE/USD oracle
```
Testnet QIE: https://www.qie.digital/faucet (2 QIE/day).

## Contract rules
| Action | Who | When |
|---|---|---|
| `join(seat)` | anyone | while Open, before the join deadline; locks that seat's collateral |
| `leave()` | member | while Open; collateral credited back |
| `cancel()` | anyone | Open circle past its join deadline; everyone's collateral credited back |
| `contribute()` | active member | once per round, before the round deadline |
| `settleRound()` | anyone | when all active members have paid, or after the deadline |
| `prefund(amount)` / `withdrawPrefund()` | member | Open or Active |
| `topUpCollateral(amount)` | member | Open or Active |
| `proposeSwap(seat)` / `acceptSwap(proposer)` / `cancelSwap()` | members | both seats not yet reached |
| `requestGrace()` / `approveGrace(member)` | active members | during the round |
| `withdraw()` | anyone with a balance | any time |

All payouts are credited and pulled with `withdraw()`. Native overpayment is credited back, so the app
sends a 1% buffer on USD-priced circles to absorb price moves.

## Known limits
- With track-record discounts on, an early seat is not fully collateralised; the group trusts that
  member's history for the discounted part. Circles that turn discounts off are fully covered.
- USD-priced circles lock collateral in QIE at the join-time price; a large QIE price drop reduces how
  much of the remaining rounds it covers in USD terms.
- USD-priced circles need a fresh oracle answer (≤ 24h old) to join, pay, or settle a round with misses.
- Token circles assume the token has no transfer fee.
