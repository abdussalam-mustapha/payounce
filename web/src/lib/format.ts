import { formatUnits, zeroAddress } from "viem";

export const STATUS = ["Open", "Active", "Completed", "Cancelled"] as const;

export function shortAddr(a?: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

export function fmtAmount(value: bigint | undefined, decimals = 18, max = 2) {
  if (value === undefined) return "—";
  const n = Number(formatUnits(value, decimals));
  return n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 4 : max });
}

export function fmtUsd(n: number) {
  const digits = n > 0 && n < 1 ? 4 : n % 1 ? 2 : 0;
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: digits });
}

export function fmtUsdCents(cents: bigint) {
  return fmtUsd(Number(cents) / 100);
}

export function periodLabel(seconds: number) {
  if (seconds === 86_400) return "day";
  if (seconds === 604_800) return "week";
  if (seconds === 1_209_600) return "2 weeks";
  if (seconds === 2_592_000) return "month";
  if (seconds < 3600 && seconds % 60 === 0) return `${seconds / 60} min`;
  return fmtDuration(seconds);
}

export function fmtDuration(seconds: number) {
  if (seconds <= 0) return "0m";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export function fmtDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Human contribution label, e.g. "$25" or "50 QIE". */
export function contributionLabel(c: { usdPriced: boolean; contribution: bigint; token: string }) {
  return c.usdPriced ? fmtUsdCents(c.contribution) : `${fmtAmount(c.contribution)} ${c.token === zeroAddress ? "QIE" : "tokens"}`;
}

export function errMsg(e: unknown) {
  const err = e as { shortMessage?: string; message?: string };
  const msg = err?.shortMessage ?? err?.message ?? String(e);
  if (/user rejected|denied/i.test(msg)) return "You cancelled the request in your wallet.";
  return msg;
}
