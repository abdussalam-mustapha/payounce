import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useConnection, usePublicClient, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { erc20Abi, isAddress, maxUint256, zeroAddress } from "viem";
import { payounceCircleAbi, payounceReputationAbi } from "../lib/abi";
import { activeChain, explorerAddress } from "../lib/chains";
import { STATUS, contributionLabel, errMsg, fmtAmount, fmtDate, fmtDuration, fmtUsd, periodLabel, shortAddr } from "../lib/format";
import { useCircleSummaries } from "../lib/useCircle";
import { buildIcs, downloadFile } from "../lib/ics";
import { Dial, type Seat } from "../components/Dial";
import { Avatar } from "../components/Avatar";

/** members(addr) => [joined, defaulted, receivedPayout, graceUsed, seat, collateral, contributed, prefunded] */
type MemberInfo = readonly [boolean, boolean, boolean, boolean, number, bigint, bigint, bigint];
/** swapOffers(addr) => [active, targetSeat, deposit] */
type Offer = readonly [boolean, number, bigint];
type MemberData = { paid?: boolean; info?: MemberInfo; offer?: Offer; graceRound?: bigint; graceVotes?: bigint; verified?: boolean; iVoted?: boolean };

const isEmpty = (a?: string) => !a || a === zeroAddress;

function useChainNow() {
  const client = usePublicClient();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    let alive = true;
    const sync = () => client?.getBlock().then((b) => alive && setOffset(Number(b.timestamp) - Math.floor(Date.now() / 1000)));
    sync();
    const t = setInterval(sync, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [client]);
  return now + Math.max(offset, 0);
}

export function CircleView() {
  const { address: param } = useParams();
  const circleAddr = (isAddress(param ?? "") ? param : undefined) as `0x${string}` | undefined;
  const { address: me } = useConnection();
  const client = usePublicClient();
  const write = useWriteContract();
  const now = useChainNow();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [pick, setPick] = useState<number>();
  const [aheadRounds, setAheadRounds] = useState(1);
  const [swapTarget, setSwapTarget] = useState<number>();

  const { circles, refetch: refetchSummary, isLoading } = useCircleSummaries(circleAddr ? [circleAddr] : undefined);
  const c = circles[0];
  const seatsArr = c?.getSeats ?? [];
  const isNative = c?.token === zeroAddress;
  const unit = isNative ? "QIE" : "tokens";
  const base = { address: circleAddr!, abi: payounceCircleAbi } as const;
  const repBase = { address: c?.reputation, abi: payounceReputationAbi } as const;
  const occupied = seatsArr.filter((a) => !isEmpty(a));
  const round = c ? c.currentRound : 0n;

  const live = useReadContracts({
    contracts: [
      { ...base, functionName: "contributionDue" },
      { ...base, functionName: "claimable", args: [me ?? zeroAddress] },
      { ...base, functionName: "members", args: [me ?? zeroAddress] },
      { ...base, functionName: "roundCovered" },
    ],
    query: { enabled: !!c, refetchInterval: 15_000 },
  });

  const PER = 7;
  const memberReads = useReadContracts({
    contracts: occupied.flatMap((m) => [
      { ...base, functionName: "hasPaid", args: [round, m] } as const,
      { ...base, functionName: "members", args: [m] } as const,
      { ...base, functionName: "swapOffers", args: [m] } as const,
      { ...base, functionName: "graceRequestRound", args: [m] } as const,
      { ...base, functionName: "graceVotes", args: [m] } as const,
      { ...repBase, functionName: "isVerified", args: [m] } as const,
      { ...base, functionName: "graceVoted", args: [round, m, me ?? zeroAddress] } as const,
    ]),
    query: { enabled: !!c && occupied.length > 0, refetchInterval: 15_000 },
  });

  // Collateral quotes for every seat (includes the viewer's track-record discount) and seat premiums.
  const quotes = useReadContracts({
    contracts: seatsArr.flatMap((_, i) => [
      { ...base, functionName: "collateralFor", args: [i, me ?? zeroAddress] } as const,
      { ...base, functionName: "baseCollateral", args: [i] } as const,
      { ...base, functionName: "premiumFor", args: [i] } as const,
    ]),
    query: { enabled: !!c && (c.status === 0 || c.status === 1), refetchInterval: 30_000 },
  });

  const rep = useReadContracts({
    contracts: [
      { ...repBase, functionName: "recordOf", args: [me ?? zeroAddress] },
      { ...repBase, functionName: "discountBps", args: [me ?? zeroAddress] },
      { ...repBase, functionName: "isVerified", args: [me ?? zeroAddress] },
    ],
    query: { enabled: !!c && !!me },
  });

  const allowance = useReadContract({
    address: c?.token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [me ?? zeroAddress, circleAddr ?? zeroAddress],
    query: { enabled: !!c && !isNative && !!me },
  });

  if (!circleAddr) return <div className="empty-state"><p>That isn't a valid circle address.</p><Link to="/" className="btn">Back to circles</Link></div>;
  if (!c) return isLoading ? <div className="circle-skel"><div className="skeleton round" /><div className="skeleton" /></div> : <div className="empty-state"><p>Circle not found on {activeChain.name}.</p></div>;

  // ---------------- derived state ----------------
  const due = live.data?.[0]?.result as bigint | undefined;
  const myClaimable = (live.data?.[1]?.result as bigint | undefined) ?? 0n;
  const myInfo = live.data?.[2]?.result as MemberInfo | undefined;
  const covered = !!live.data?.[3]?.result;

  const data = new Map<string, MemberData>();
  occupied.forEach((m, i) => {
    const r = memberReads.data;
    const at = (k: number) => r?.[PER * i + k]?.result;
    data.set(m.toLowerCase(), {
      paid: at(0) as boolean | undefined,
      info: at(1) as MemberInfo | undefined,
      offer: at(2) as Offer | undefined,
      graceRound: at(3) as bigint | undefined,
      graceVotes: at(4) as bigint | undefined,
      verified: at(5) as boolean | undefined,
      iVoted: at(6) as boolean | undefined,
    });
  });
  const of = (a?: string) => (a ? data.get(a.toLowerCase()) : undefined);
  const quote = (i: number) => quotes.data?.[3 * i]?.result as bigint | undefined;
  const baseQuote = (i: number) => quotes.data?.[3 * i + 1]?.result as bigint | undefined;
  const premiumOf = (i: number) => (quotes.data?.[3 * i + 2]?.result as bigint | undefined) ?? 0n;
  const record = rep.data?.[0]?.result as { circlesCompleted: number; onTimePayments: number; missedPayments: number; gracesReceived: number; defaults: number } | undefined;
  const discount = Number((rep.data?.[1]?.result as bigint | undefined) ?? 0n);
  const meVerified = !!rep.data?.[2]?.result;

  const joined = !!myInfo?.[0];
  const defaulted = !!myInfo?.[1];
  const graceUsed = !!myInfo?.[3];
  const mySeat = joined ? Number(myInfo?.[4]) : -1;
  const myCollateral = myInfo?.[5] ?? 0n;
  const myPrefund = myInfo?.[7] ?? 0n;
  const iPaid = !!of(me)?.paid;
  const r = Number(round);
  const period = Number(c.period);
  const start = Number(c.startTime);
  const deadline = start + (r + 1) * period;
  const recipient = c.status === 1 ? seatsArr[r] : undefined;
  const canSettle = c.status === 1 && (covered || now > deadline);
  const roundProgress = c.status === 1 ? 1 - Math.max(deadline - now, 0) / period : c.status === 2 ? 1 : undefined;
  const qiePerUsd = c.usdPriced && due ? Number(due) / 1e18 / (Number(c.contribution) / 100) : undefined;
  const asUsd = (v?: bigint) => (qiePerUsd && v !== undefined ? fmtUsd(Number(v) / 1e18 / qiePerUsd) : undefined);
  const show = (v?: bigint) => asUsd(v) ?? `${fmtAmount(v)} ${unit}`;
  const fullPot = c.usdPriced ? fmtUsd((Number(c.contribution) / 100) * c.maxMembers) : `${fmtAmount(c.contribution * BigInt(c.maxMembers))} ${unit}`;
  const openSeats = seatsArr.map((a, i) => (isEmpty(a) ? i : -1)).filter((i) => i >= 0);
  const chosen = pick !== undefined && isEmpty(seatsArr[pick]) ? pick : openSeats[openSeats.length - 1];
  const swappable = (i: number) => c.status === 0 || (c.status === 1 && i > r);
  const myOffer = of(me)?.offer;
  const incomingOffers = occupied.filter((m) => {
    const o = of(m)?.offer;
    return o?.[0] && Number(o[1]) === mySeat && m.toLowerCase() !== me?.toLowerCase();
  });
  const graceRequests = occupied.filter((m) => {
    const d = of(m);
    return c.status === 1 && d?.graceRound === round + 1n && !d.info?.[3] && !d.info?.[1];
  });
  const others = Number(c.activeCount) - 1;

  const seats: Seat[] = seatsArr.map((address, i) => {
    if (isEmpty(address)) return { state: "open" };
    const d = of(address);
    const you = address.toLowerCase() === me?.toLowerCase();
    if (d?.info?.[1]) return { address, state: "defaulted", you };
    if (c.status === 2 || (c.status === 1 && i < r)) return { address, state: "paid-out", you };
    if (c.status === 1 && i === r) return { address, state: "current", you, paidThisRound: d?.paid };
    return { address, state: "upcoming", you, paidThisRound: c.status === 1 && d?.paid };
  });

  // ---------------- actions ----------------
  async function run(label: string, fn: () => Promise<`0x${string}`>, success: string) {
    setError(undefined);
    setDone(undefined);
    setBusy(label);
    try {
      const hash = await fn();
      await client!.waitForTransactionReceipt({ hash });
      await Promise.all([refetchSummary(), live.refetch(), memberReads.refetch(), quotes.refetch(), rep.refetch(), allowance.refetch()]);
      setDone(success);
      setPick(undefined);
      setSwapTarget(undefined);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(undefined);
    }
  }

  // USD-priced circles send 1% extra to absorb price moves; the contract credits the excess back.
  const withBuffer = (v: bigint) => (c.usdPriced ? (v * 101n) / 100n : v);
  const valueFor = (v: bigint) => (isNative ? { value: withBuffer(v) } : {});
  const needsApproval = !isNative && (allowance.data ?? 0n) < (due ?? 0n) * BigInt(c.maxMembers);

  const join = (seat: number) =>
    run("join", () => write.mutateAsync({ ...base, functionName: "join", args: [seat], ...valueFor(quote(seat) ?? 0n) }), `You took seat ${seat + 1}. The circle starts when every seat is filled.`);
  const contribute = () => run("contribute", () => write.mutateAsync({ ...base, functionName: "contribute", ...valueFor(due ?? 0n) }), `Round ${r + 1} paid.`);
  const payAhead = () => {
    const amount = withBuffer((due ?? 0n) * BigInt(aheadRounds));
    return run("prefund", () => write.mutateAsync({ ...base, functionName: "prefund", args: [amount], ...(isNative ? { value: amount } : {}) }), `${aheadRounds} round${aheadRounds > 1 ? "s" : ""} paid ahead. They'll be paid automatically, on time.`);
  };
  const topUp = () => {
    const amount = due ?? 0n;
    return run("topup", () => write.mutateAsync({ ...base, functionName: "topUpCollateral", args: [amount], ...(isNative ? { value: amount } : {}) }), "Collateral topped up.");
  };
  const proposeSwap = (target: number) => {
    const need = quote(target) ?? 0n;
    const deposit = need > myCollateral ? need - myCollateral : 0n;
    return run("swap", () => write.mutateAsync({ ...base, functionName: "proposeSwap", args: [target], ...valueFor(deposit) }), `Swap offered to seat ${target + 1}. They need to accept it.`);
  };
  const acceptSwap = (proposer: `0x${string}`) => {
    const theirSeat = Number(of(proposer)?.info?.[4] ?? 0);
    const need = quote(theirSeat) ?? 0n;
    const extra = need > myCollateral ? need - myCollateral : 0n;
    return run("accept", () => write.mutateAsync({ ...base, functionName: "acceptSwap", args: [proposer], ...valueFor(extra) }), `Seats swapped. You're now in seat ${theirSeat + 1}.`);
  };
  const call = (fn: "leave" | "cancel" | "settleRound" | "withdraw" | "cancelSwap" | "requestGrace" | "withdrawPrefund", msg: string) =>
    run(fn, () => write.mutateAsync({ ...base, functionName: fn }), msg);
  const approveGrace = (m: `0x${string}`) => run("grace-" + m, () => write.mutateAsync({ ...base, functionName: "approveGrace", args: [m] }), "Vote recorded.");
  const approve = () => run("approve", () => write.mutateAsync({ address: c.token, abi: erc20Abi, functionName: "approve", args: [circleAddr, maxUint256] }), "Token approved.");

  const share = async () => {
    const text = `Join my savings circle "${c.name}" on Payounce: ${contributionLabel(c)} per ${periodLabel(period)}, ${c.maxMembers} seats. Pick your seat:\n${window.location.href}`;
    if (navigator.share) await navigator.share({ text }).catch(() => {});
    else {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const exportCalendar = () => {
    const url = window.location.href;
    const events = Array.from({ length: c.maxMembers }, (_, i) => i)
      .filter((i) => i >= r)
      .map((i) => ({
        uid: `${circleAddr}-${i}-pay`,
        start: start + (i + 1) * period - 3600,
        title: `Payounce: pay ${contributionLabel(c)} for "${c.name}" (round ${i + 1})`,
        description: i === mySeat ? `This is your payout round: you receive the pot of ${fullPot}.` : `Pay before the round closes so your record stays clean.`,
        url,
      }));
    downloadFile(`payounce-${c.name.replace(/\W+/g, "-").toLowerCase()}.ics`, buildIcs(`Payounce · ${c.name}`, events));
  };

  // ---------------- primary call to action ----------------
  let primary: ReactNode = null;
  let headline = "";
  let sub: ReactNode = "";
  if (!me) {
    headline = "Connect to take part";
    sub = "Connect your wallet to pick a seat or pay your round.";
  } else if (c.status === 0 && !joined) {
    headline = "Pick your seat";
    sub = c.requireVerified && !meVerified
      ? <>This circle only admits QIE ID-verified members. <Link to={`/u/${me}`} className="inline-link">Verify on your passport →</Link></>
      : "Early seats get paid first and lock what they'll still owe. Later seats lock less, and earn the early seats' premiums.";
    primary = (
      <>
        <div className="seat-picker">
          {openSeats.map((i) => (
            <button key={i} type="button" className={chosen === i ? "on" : ""} onClick={() => setPick(i)}>
              <span className="sp-n">Seat {i + 1}</span>
              <span className="sp-when">paid out round {i + 1}</span>
              <b>{quote(i) === 0n ? "No collateral" : show(quote(i))}</b>
              {quote(i) !== undefined && baseQuote(i) !== undefined && quote(i)! < baseQuote(i)! && <s className="sp-was">{show(baseQuote(i))}</s>}
              {c.premiumBps > 0 && (premiumOf(i) > 0n ? <span className="sp-prem">pays {show(premiumOf(i))} premium</span> : <span className="sp-prem earn">earns premiums</span>)}
            </button>
          ))}
        </div>
        {chosen !== undefined && (
          <button className="btn lg block" disabled={!!busy || needsApproval || now > Number(c.joinDeadline) || (c.requireVerified && !meVerified)} onClick={() => join(chosen)}>
            {busy === "join" ? "Joining…" : `Take seat ${chosen + 1}${quote(chosen) ? ` · lock ${show(quote(chosen))}` : ""}`}
          </button>
        )}
      </>
    );
  } else if (c.status === 0 && joined) {
    headline = `You're in seat ${mySeat + 1}`;
    sub = `You'll collect the pot in round ${mySeat + 1}. Waiting for ${c.maxMembers - Number(c.memberCount)} more. Share the invite to fill the circle.`;
    primary = <button className="btn lg block" onClick={share}>{copied ? "Invite copied" : "Share invite"}</button>;
  } else if (c.status === 1 && defaulted) {
    headline = "You've defaulted";
    sub = "Your collateral ran out covering missed payments. If you hadn't been paid out yet, you'll get back what you paid in, minus 10%, when the circle ends.";
  } else if (c.status === 1 && joined && !iPaid && now <= deadline) {
    headline = `Pay round ${r + 1}`;
    sub = myPrefund >= (due ?? 1n)
      ? `Your prepaid balance covers this round. It will be paid automatically, on time.`
      : `${contributionLabel(c)}${c.usdPriced ? ` ≈ ${fmtAmount(due)} QIE` : ""}, due in ${fmtDuration(deadline - now)}. ${recipient?.toLowerCase() === me.toLowerCase() ? "This round's pot is yours." : `This round's pot goes to seat ${r + 1}.`}`;
    primary = myPrefund >= (due ?? 1n) ? null : (
      <button className="btn lg block" disabled={!!busy || needsApproval} onClick={contribute}>
        {busy === "contribute" ? "Paying…" : `Pay ${contributionLabel(c)}`}
      </button>
    );
  } else if (c.status === 1 && joined && iPaid) {
    headline = "You're paid up";
    sub = `Round ${r + 1} is covered. ${covered ? "The round can be settled now." : `Waiting on ${Number(c.activeCount - c.paidCount)} more.`}`;
  } else if (c.status === 1 && joined && now > deadline) {
    headline = "Round closed";
    sub = "You missed this round. It will be covered from your collateral when the round is settled.";
  } else if (c.status === 1) {
    headline = "Circle in progress";
    sub = "Every seat is taken. You can follow along or settle rounds.";
  } else if (c.status === 2) {
    headline = "Circle complete";
    sub = "Every seat has had its turn, and every member's result is on their savings passport.";
  } else {
    headline = "Circle cancelled";
    sub = "It didn't fill before the join deadline. Members can withdraw their collateral.";
  }

  const memberActive = joined && !defaulted && (c.status === 0 || c.status === 1);

  return (
    <div className="circle-page">
      <Link to="/" className="back">← All circles</Link>

      <header className="circle-head">
        <div>
          <div className="row-tight wrap">
            <span className={`pill s${c.status}`}>{STATUS[c.status]}</span>
            <span className="muted small">by <Link to={`/u/${c.creator}`} className="inline-link">{shortAddr(c.creator)}</Link></span>
            {c.useReputation && <span className="pill rep">Track record rewarded</span>}
            {c.premiumBps > 0 && <span className="pill gold">{c.premiumBps / 100}% seat premium</span>}
            {c.requireVerified && <span className="pill s0">QIE ID verified only</span>}
          </div>
          <h1 className="display">{c.name}</h1>
          <p className="lede sm">{contributionLabel(c)} per {periodLabel(period)} · {c.maxMembers} seats · pot {fullPot}</p>
        </div>
        <div className="head-actions">
          <button className="btn ghost" onClick={share}>{copied ? "Copied" : "Share invite"}</button>
          {joined && start > 0 && <button className="btn ghost" onClick={exportCalendar}>Add to calendar</button>}
          {explorerAddress(circleAddr) && <a className="btn ghost" href={explorerAddress(circleAddr)} target="_blank" rel="noreferrer">Contract ↗</a>}
        </div>
      </header>

      <div className="circle-grid">
        <section className="dial-panel">
          <Dial
            seats={seats}
            size={400}
            progress={roundProgress}
            onSeatClick={c.status === 0 && me && !joined ? setPick : undefined}
            selected={c.status === 0 && me && !joined ? chosen : undefined}
            center={
              c.status === 1 ? (
                <>
                  <span className="eyebrow">Round {r + 1} of {c.maxMembers}</span>
                  <span className="pot">{asUsd(c.pot) ?? fmtAmount(c.pot)}</span>
                  <span className="muted small">{asUsd(c.pot) ? `${fmtAmount(c.pot)} QIE in the pot` : `${unit} in the pot`}</span>
                  <span className="countdown">{now > deadline ? "Round ended" : `${fmtDuration(deadline - now)} left`}</span>
                </>
              ) : c.status === 0 ? (
                <>
                  <span className="eyebrow">Seats taken</span>
                  <span className="pot">{Number(c.memberCount)}<span className="of">/{c.maxMembers}</span></span>
                  <span className="muted small">joining closes in {fmtDuration(Number(c.joinDeadline) - now)}</span>
                </>
              ) : (
                <>
                  <span className="eyebrow">{STATUS[c.status]}</span>
                  <span className="pot sm">{fullPot}</span>
                  <span className="muted small">per payout</span>
                </>
              )
            }
          />
          <ul className="legend">
            <li><i className="lg-paid" />Paid out</li>
            <li><i className="lg-current" />Receiving now</li>
            <li><i className="lg-up" />Upcoming</li>
            <li><i className="lg-open" />Open seat</li>
            {seats.some((s) => s.state === "defaulted") && <li><i className="lg-def" />Defaulted</li>}
          </ul>
        </section>

        <aside className="action-col">
          <div className="action-card">
            <h2>{headline}</h2>
            <p className="muted">{sub}</p>
            {needsApproval && me && (c.status === 0 || c.status === 1) && !defaulted && (
              <button className="btn lg block" disabled={!!busy} onClick={approve}>{busy === "approve" ? "Approving…" : "Approve token first"}</button>
            )}
            {primary}
            {canSettle && (
              <button className={`btn ${primary ? "ghost" : ""} lg block`} disabled={!!busy} onClick={() => call("settleRound", `Round ${r + 1} settled.`)}>
                {busy === "settleRound" ? "Settling…" : `Settle round · pay seat ${r + 1}`}
              </button>
            )}
            {myClaimable > 0n && (
              <div className="claim">
                <div>
                  <span className="eyebrow">Ready to withdraw</span>
                  <b>{fmtAmount(myClaimable)} {unit}</b>
                  {asUsd(myClaimable) && <span className="muted small"> ≈ {asUsd(myClaimable)}</span>}
                </div>
                <button className="btn" disabled={!!busy} onClick={() => call("withdraw", "Withdrawn to your wallet.")}>{busy === "withdraw" ? "Sending…" : "Withdraw"}</button>
              </div>
            )}
            {c.status === 0 && joined && (
              <button className="linkish" disabled={!!busy} onClick={() => call("leave", "You left the circle. Your collateral is ready to withdraw.")}>Leave circle</button>
            )}
            {c.status === 0 && now > Number(c.joinDeadline) && (
              <button className="btn ghost block" disabled={!!busy} onClick={() => call("cancel", "Circle cancelled.")}>Cancel unfilled circle</button>
            )}
            {busy && <p className="status pending">Waiting for confirmation…</p>}
            {done && !busy && <p className="status ok">{done}</p>}
            {error && <p className="status err">{error}</p>}
          </div>

          {/* Requests that need this member's attention */}
          {me && joined && !defaulted && (incomingOffers.length > 0 || graceRequests.some((m) => m.toLowerCase() !== me.toLowerCase())) && (
            <div className="tool-card attention">
              <span className="eyebrow">Needs your answer</span>
              {incomingOffers.map((m) => {
                const theirSeat = Number(of(m)?.info?.[4] ?? 0);
                const need = quote(theirSeat) ?? 0n;
                const extra = need > myCollateral ? need - myCollateral : 0n;
                return (
                  <div key={m} className="ask">
                    <p><b>{shortAddr(m)}</b> wants to swap their seat {theirSeat + 1} for your seat {mySeat + 1}. {extra > 0n ? `You'd add ${show(extra)} collateral.` : myCollateral > need ? `You'd get ${show(myCollateral - need)} collateral back.` : ""}</p>
                    <button className="btn sm" disabled={!!busy} onClick={() => acceptSwap(m)}>Accept swap</button>
                  </div>
                );
              })}
              {graceRequests.filter((m) => m.toLowerCase() !== me.toLowerCase()).map((m) => {
                const d = of(m);
                return (
                  <div key={m} className="ask">
                    <p><b>{shortAddr(m)}</b> is going through hardship and asks the group to forgive missing round {r + 1}. Their collateral still covers the pot. {Number(d?.graceVotes ?? 0n)} of {others} have agreed; {Math.floor(others / 2) + 1} needed.</p>
                    {d?.iVoted ? <span className="pill s2">You agreed</span> : <button className="btn sm" disabled={!!busy} onClick={() => approveGrace(m)}>Agree</button>}
                  </div>
                );
              })}
            </div>
          )}

          {memberActive && (
            <div className="tool-card">
              <span className="eyebrow">Member tools</span>

              {c.status === 1 && (
                <div className="tool">
                  <div>
                    <h3>Pay ahead</h3>
                    <p className="muted small">Prepaid rounds pay automatically and always count as on time.{myPrefund > 0n && ` Prepaid now: ${show(myPrefund)}.`}</p>
                  </div>
                  <div className="tool-row">
                    <select value={aheadRounds} onChange={(e) => setAheadRounds(Number(e.target.value))} aria-label="Rounds to prepay">
                      {[1, 2, 3, 4, 6].filter((n) => n <= c.maxMembers - r).map((n) => <option key={n} value={n}>{n} round{n > 1 ? "s" : ""}</option>)}
                    </select>
                    <button className="btn sm" disabled={!!busy || needsApproval} onClick={payAhead}>{busy === "prefund" ? "Paying…" : "Pay ahead"}</button>
                    {myPrefund > 0n && <button className="linkish" onClick={() => call("withdrawPrefund", "Prepaid balance moved to your withdrawable funds.")}>Take back</button>}
                  </div>
                </div>
              )}

              {swappable(mySeat) && (
                <div className="tool">
                  <div>
                    <h3>Swap seats</h3>
                    <p className="muted small">Need the money sooner, or later? Offer a swap; your collateral is rebalanced automatically.</p>
                  </div>
                  {myOffer?.[0] ? (
                    <div className="tool-row">
                      <span className="small">Waiting for seat {Number(myOffer[1]) + 1} to accept.</span>
                      <button className="linkish" onClick={() => call("cancelSwap", "Swap offer withdrawn.")}>Withdraw offer</button>
                    </div>
                  ) : (
                    <div className="tool-row">
                      <select value={swapTarget ?? ""} onChange={(e) => setSwapTarget(e.target.value === "" ? undefined : Number(e.target.value))} aria-label="Seat to swap with">
                        <option value="">Choose a seat…</option>
                        {seatsArr.map((a, i) => (!isEmpty(a) && i !== mySeat && swappable(i) ? <option key={i} value={i}>Seat {i + 1} · {shortAddr(a)}</option> : null))}
                      </select>
                      <button className="btn sm" disabled={!!busy || swapTarget === undefined} onClick={() => swapTarget !== undefined && proposeSwap(swapTarget)}>Offer swap</button>
                    </div>
                  )}
                  {swapTarget !== undefined && quote(swapTarget) !== undefined && (
                    <p className="muted small">Seat {swapTarget + 1} locks {show(quote(swapTarget))}; you hold {show(myCollateral)}.</p>
                  )}
                </div>
              )}

              {c.status === 1 && (
                <div className="tool">
                  <div>
                    <h3>Hardship grace</h3>
                    <p className="muted small">Can't pay this round? Ask the group. If most agree, the miss is covered from your collateral and kept off your record. Once per circle.</p>
                  </div>
                  <div className="tool-row">
                    {graceUsed ? (
                      <span className="small muted">You've used your grace in this circle.</span>
                    ) : of(me)?.graceRound === round + 1n ? (
                      <span className="small">Asked · {Number(of(me)?.graceVotes ?? 0n)} of {others} agreed ({Math.floor(others / 2) + 1} needed)</span>
                    ) : (
                      <button className="btn ghost sm" disabled={!!busy || iPaid} onClick={() => call("requestGrace", "Your request was sent to the group.")}>Ask for grace</button>
                    )}
                    <button className="linkish" onClick={topUp} disabled={!!busy}>Top up collateral</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {me && (
            <Link to={`/u/${me}`} className="record-card">
              <div className="row">
                <span className="eyebrow">Your savings passport</span>
                {meVerified ? <span className="pill s2">QIE ID verified</span> : discount > 0 && <span className="pill s2">{discount / 100}% less collateral</span>}
              </div>
              <div className="record-stats">
                <div><b>{record?.circlesCompleted ?? 0}</b><span>circles finished</span></div>
                <div><b>{record?.onTimePayments ?? 0}</b><span>on-time payments</span></div>
                <div><b>{record?.missedPayments ?? 0}</b><span>missed</span></div>
              </div>
              <span className="muted small">View passport →</span>
            </Link>
          )}
        </aside>
      </div>

      <section className="schedule">
        <h2>Payout schedule</h2>
        <ol>
          {seatsArr.map((m, i) => {
            const d = isEmpty(m) ? undefined : of(m);
            const info = d?.info;
            const you = !isEmpty(m) && m.toLowerCase() === me?.toLowerCase();
            const when = start ? fmtDate(start + (i + 1) * period) : `Round ${i + 1}`;
            let state = "Upcoming";
            let cls = "up";
            if (isEmpty(m)) { state = "Open seat"; cls = "open"; }
            else if (info?.[1]) { state = "Defaulted"; cls = "def"; }
            else if (c.status === 2 || (c.status === 1 && i < r)) { state = "Paid out"; cls = "paid"; }
            else if (c.status === 1 && i === r) { state = "Receiving now"; cls = "current"; }
            return (
              <li key={i} className={`sched ${cls}`}>
                <span className="sched-n">{String(i + 1).padStart(2, "0")}</span>
                {isEmpty(m) ? <span className="avatar empty" /> : <Avatar address={m} size={30} />}
                <span className="sched-who">
                  {isEmpty(m) ? <span className="mono">Open seat</span> : <Link to={`/u/${m}`} className="mono inline-link">{shortAddr(m)}</Link>}
                  {d?.verified && <span className="verified" title="QIE ID verified">✓</span>}
                  {you && <span className="you-tag">You</span>}
                  {info?.[3] && <span className="muted small">graced</span>}
                </span>
                <span className="sched-meta">
                  {c.status === 1 && !isEmpty(m) && !info?.[1] && <span className={`dot ${d?.paid ? "on" : ""}`}>{d?.paid ? "Paid" : info?.[7] && due && info[7] >= due ? "Prepaid" : "Unpaid"}</span>}
                  {!isEmpty(m) && <span className="muted small">locked {show(info?.[5])}</span>}
                </span>
                <span className="sched-when muted small">{when}</span>
                <span className={`sched-state ${cls}`}>{state}</span>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
