import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useConnection, useReadContract, useReadContracts } from "wagmi";
import { isAddress, zeroAddress } from "viem";
import { payounceFactoryAbi, payounceReputationAbi } from "../lib/abi";
import { factoryAddress } from "../lib/chains";
import { STATUS, contributionLabel, fmtDate, periodLabel, shortAddr } from "../lib/format";
import { useCircleSummaries } from "../lib/useCircle";
import { Avatar } from "../components/Avatar";

type Record = {
  circlesJoined: number;
  circlesCompleted: number;
  onTimePayments: number;
  missedPayments: number;
  gracesReceived: number;
  defaults: number;
  firstActivity: bigint;
  lastActivity: bigint;
};

/** Public savings passport: a portable, verifiable record of how someone saves. */
export function Passport() {
  const { address: param } = useParams();
  const who = (isAddress(param ?? "") ? param : undefined) as `0x${string}` | undefined;
  const { address: me } = useConnection();
  const [copied, setCopied] = useState(false);

  const { data: repAddr } = useReadContract({ address: factoryAddress, abi: payounceFactoryAbi, functionName: "reputation" });
  const repBase = { address: repAddr, abi: payounceReputationAbi } as const;
  const reads = useReadContracts({
    contracts: [
      { ...repBase, functionName: "recordOf", args: [who ?? zeroAddress] },
      { ...repBase, functionName: "discountBps", args: [who ?? zeroAddress] },
      { ...repBase, functionName: "isVerified", args: [who ?? zeroAddress] },
      { ...repBase, functionName: "circlesOf", args: [who ?? zeroAddress] },
    ],
    query: { enabled: !!repAddr && !!who },
  });
  const record = reads.data?.[0]?.result as Record | undefined;
  const discount = Number((reads.data?.[1]?.result as bigint | undefined) ?? 0n);
  const verified = !!reads.data?.[2]?.result;
  const circleAddrs = reads.data?.[3]?.result as readonly `0x${string}`[] | undefined;
  const { circles } = useCircleSummaries(circleAddrs ? [...new Set(circleAddrs)].reverse() : undefined);

  if (!who) return <div className="empty-state"><p>That isn't a valid wallet address.</p></div>;

  const isMe = me?.toLowerCase() === who.toLowerCase();
  const paid = (record?.onTimePayments ?? 0) + (record?.missedPayments ?? 0);
  const reliability = paid ? Math.round(((record?.onTimePayments ?? 0) / paid) * 100) : undefined;
  const standing = record?.defaults
    ? { label: "Has defaulted", cls: "s3" }
    : (record?.circlesCompleted ?? 0) >= 2
      ? { label: "Trusted saver", cls: "s2" }
      : (record?.circlesCompleted ?? 0) === 1
        ? { label: "Proven saver", cls: "s2" }
        : record?.circlesJoined
          ? { label: "Building a record", cls: "s1" }
          : { label: "New", cls: "s0" };

  const share = async () => {
    const text = `My Payounce savings passport: ${record?.circlesCompleted ?? 0} circles finished, ${reliability ?? "—"}% on-time.\n${window.location.href}`;
    if (navigator.share) await navigator.share({ text }).catch(() => {});
    else {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  return (
    <div className="passport-page">
      <Link to="/" className="back">← All circles</Link>

      <section className="passport">
        <div className="passport-head">
          <Avatar address={who} size={72} />
          <div>
            <span className="eyebrow">Savings passport</span>
            <h1 className="display">{isMe ? "Your record" : shortAddr(who)}</h1>
            <p className="mono muted small">{who}</p>
          </div>
          <div className="passport-badges">
            <span className={`pill ${standing.cls}`}>{standing.label}</span>
            {verified ? <span className="pill s2">QIE ID verified</span> : <span className="pill s0 dim">Not verified</span>}
          </div>
        </div>

        <div className="passport-score">
          <div className="score-ring" style={{ ["--p" as string]: `${reliability ?? 0}` }}>
            <span className="score-num">{reliability === undefined ? "—" : `${reliability}%`}</span>
            <span className="muted small">on time</span>
          </div>
          <dl className="passport-stats">
            <div><dt>Circles finished</dt><dd>{record?.circlesCompleted ?? 0}</dd></div>
            <div><dt>Circles joined</dt><dd>{record?.circlesJoined ?? 0}</dd></div>
            <div><dt>On-time payments</dt><dd>{record?.onTimePayments ?? 0}</dd></div>
            <div><dt>Missed (covered)</dt><dd>{record?.missedPayments ?? 0}</dd></div>
            <div><dt>Hardship graces</dt><dd>{record?.gracesReceived ?? 0}</dd></div>
            <div><dt>Defaults</dt><dd>{record?.defaults ?? 0}</dd></div>
          </dl>
        </div>

        <div className="passport-foot">
          <p className="muted small">
            {discount > 0
              ? `Earned ${discount / 100}% off early-seat collateral in circles that reward track records.`
              : record?.defaults
                ? "A past default means full collateral for early seats."
                : "Each circle finished cleanly earns 25% off early-seat collateral, up to 50%."}
            {record?.firstActivity ? ` Saving with Payounce since ${fmtDate(Number(record.firstActivity))}.` : ""}
          </p>
          <div className="row gap">
            <button className="btn ghost sm" onClick={share}>{copied ? "Copied" : "Share passport"}</button>
            {isMe && !verified && (
              <a className="btn sm" href="https://id.qie.digital" target="_blank" rel="noreferrer">Verify with QIE ID ↗</a>
            )}
          </div>
        </div>
        <p className="passport-note muted small">
          Every number here is written on-chain by the circles themselves. Nobody, including Payounce, can edit it.
        </p>
      </section>

      <section className="schedule">
        <h2>Circles</h2>
        {circleAddrs?.length === 0 && <div className="empty-state"><p>{isMe ? "You haven't joined a circle yet." : "No circles yet."}</p><Link to="/" className="btn">Find a circle</Link></div>}
        <div className="grid">
          {circles.map((c) => (
            <Link key={c.address} to={`/c/${c.address}`} className="card circle-card">
              <div className="card-top">
                <span className={`pill s${c.status}`}>{STATUS[c.status]}</span>
              </div>
              <h3>{c.name}</h3>
              <p className="amount">{contributionLabel(c)}<span> / {periodLabel(Number(c.period))}</span></p>
              <p className="muted small">{c.maxMembers} seats</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
