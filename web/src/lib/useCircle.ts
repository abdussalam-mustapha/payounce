import { useReadContracts } from "wagmi";
import { payounceCircleAbi } from "./abi";

const FIELDS = [
  "name",
  "creator",
  "token",
  "contribution",
  "usdPriced",
  "period",
  "maxMembers",
  "joinDeadline",
  "useReputation",
  "requireVerified",
  "premiumBps",
  "reputation",
  "status",
  "startTime",
  "currentRound",
  "pot",
  "paidCount",
  "activeCount",
  "memberCount",
  "getSeats",
] as const;

export type CircleSummary = {
  address: `0x${string}`;
  name: string;
  creator: `0x${string}`;
  token: `0x${string}`;
  contribution: bigint;
  usdPriced: boolean;
  period: bigint;
  maxMembers: number;
  joinDeadline: bigint;
  useReputation: boolean;
  requireVerified: boolean;
  premiumBps: number;
  reputation: `0x${string}`;
  status: number;
  startTime: bigint;
  currentRound: bigint;
  pot: bigint;
  paidCount: bigint;
  activeCount: bigint;
  memberCount: bigint;
  getSeats: readonly `0x${string}`[];
};

/** Reads the static + state fields of many circles in one query. */
export function useCircleSummaries(addresses: readonly `0x${string}`[] | undefined) {
  const list = addresses ?? [];
  const q = useReadContracts({
    contracts: list.flatMap((address) =>
      FIELDS.map((functionName) => ({ address, abi: payounceCircleAbi, functionName }) as const),
    ),
    query: { enabled: list.length > 0, refetchInterval: 15_000 },
  });

  const circles: CircleSummary[] = [];
  if (q.data) {
    list.forEach((address, i) => {
      const row = q.data.slice(i * FIELDS.length, (i + 1) * FIELDS.length);
      if (row.some((r) => r.status !== "success")) return;
      const obj: Record<string, unknown> = { address };
      FIELDS.forEach((f, j) => (obj[f] = row[j].result));
      circles.push(obj as CircleSummary);
    });
  }
  return { ...q, circles };
}
