import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useReadContract } from "wagmi";
import { payounceFactoryAbi } from "../lib/abi";
import { factoryAddress } from "../lib/chains";
import { STATUS, contributionLabel, fmtUsdCents, periodLabel } from "../lib/format";
import { useCircleSummaries, type CircleSummary } from "../lib/useCircle";
import { Dial, type Seat } from "../components/Dial";

// Purely decorative seat colours for the illustration; no data.
const SEAT_COLOURS = ["0x7a3f9c21", "0x1be04d77", "0xc2d1aa90", "0x5e9b3f12", "0x93f7c0de", "0x2ac8e541"].map((a) =>
  a.padEnd(42, "0"),
);

function HeroDial() {
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTurn((x) => (x + 1) % SEAT_COLOURS.length), 2400);
    return () => clearInterval(t);
  }, []);
  const seats: Seat[] = SEAT_COLOURS.map((address, i) => ({
    address,
    state: i < turn ? "paid-out" : i === turn ? "current" : "upcoming",
  }));
  return (
    <div className="hero-dial" aria-hidden>
      <Dial
        seats={seats}
        size={380}
        progress={(turn + 1) / SEAT_COLOURS.length}
        center={
          <>
            <span className="eyebrow">Every round</span>
            <span className="pot sm">One member<br />takes the pot</span>
            <span className="muted small">until everyone has had a turn</span>
          </>
        }
      />
    </div>
  );
}

function seatsFor(c: CircleSummary): Seat[] {
  return Array.from({ length: c.maxMembers }, (_, i) => {
    if (!c.getSeats[i] || /^0x0+$/.test(c.getSeats[i])) return { state: "open" };
    if (c.status === 2) return { state: "paid-out" };
    if (c.status === 1) {
      const r = Number(c.currentRound);
      return { state: i < r ? "paid-out" : i === r ? "current" : "upcoming" };
    }
    return { state: "upcoming" };
  });
}

const FILTERS = ["All", "Open", "Active", "Completed"] as const;

export function Home() {
  const { data: addresses, isLoading } = useReadContract({
    address: factoryAddress,
    abi: payounceFactoryAbi,
    functionName: "getCircles",
    query: { refetchInterval: 15_000 },
  });
  const { circles } = useCircleSummaries(addresses ? [...addresses].reverse() : undefined);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");

  const shown = useMemo(
    () => circles.filter((c) => filter === "All" || STATUS[c.status] === filter),
    [circles, filter],
  );
  const usdVolume = circles
    .filter((c) => c.usdPriced)
    .reduce((s, c) => s + c.contribution * BigInt(c.maxMembers) * BigInt(c.maxMembers), 0n);

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">The savings circle, made trustless</span>
          <h1>
            Save together.
            <br />
            <em>Get paid in turn.</em>
          </h1>
          <p className="lede">
            Families, friends and coworkers everywhere pool money and take turns collecting it. It has always run on
            trust, and it breaks when someone takes the pot and stops paying. Payounce locks collateral, pays out
            automatically and prices in USD, so your circle works across cities and borders.
          </p>
          <p className="known-as">
            Known as <i>tanda</i> · <i>chit fund</i> · <i>susu</i> · <i>paluwagan</i> · <i>hui</i> · <i>kye</i> ·{" "}
            <i>chama</i> · <i>tontine</i> · <i>lending circle</i>
          </p>
          <div className="hero-cta">
            <Link to="/create" className="btn lg">Start a circle</Link>
            <a href="#circles" className="btn ghost lg">Browse circles</a>
          </div>
          <dl className="hero-stats">
            <div><dt>Circles</dt><dd>{addresses?.length ?? "—"}</dd></div>
            <div><dt>Active now</dt><dd>{circles.filter((c) => c.status === 1).length}</dd></div>
            <div><dt>Committed (USD)</dt><dd>{fmtUsdCents(usdVolume)}</dd></div>
          </dl>
        </div>
        <HeroDial />
      </section>

      <section className="how">
        {[
          ["Pick your seat", "Need money soon? Take an early seat and lock what you'll still owe. Saving? Take a late seat and lock nothing."],
          ["Pay every round", "Everyone pays the same amount, priced in USD and settled in QIE at the live QIE Oracle price."],
          ["Nobody can lose", "Whoever collects early has already covered the rest. Finish on time and build a track record that lowers your collateral next time."],
        ].map(([t, d], i) => (
          <div key={t} className="how-step">
            <span className="how-n">0{i + 1}</span>
            <h3>{t}</h3>
            <p>{d}</p>
          </div>
        ))}
      </section>

      <section id="circles" className="list-head">
        <h2>Circles</h2>
        <div className="seg" role="tablist">
          {FILTERS.map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
        </div>
      </section>

      {isLoading && (
        <div className="grid">{[0, 1, 2].map((i) => <div key={i} className="card skeleton" />)}</div>
      )}
      {!isLoading && shown.length === 0 && (
        <div className="empty-state">
          <p>No {filter === "All" ? "" : filter.toLowerCase() + " "}circles yet.</p>
          <Link to="/create" className="btn">Start the first one</Link>
        </div>
      )}
      <div className="grid">
        {shown.map((c) => {
          const filled = Number(c.memberCount) / c.maxMembers;
          return (
            <Link key={c.address} to={`/c/${c.address}`} className="card circle-card">
              <div className="card-top">
                <span className={`pill s${c.status}`}>{STATUS[c.status]}</span>
                <Dial seats={seatsFor(c)} size={64} compact />
              </div>
              <h3>{c.name}</h3>
              <p className="amount">
                {contributionLabel(c)}
                <span> / {periodLabel(Number(c.period))}</span>
              </p>
              <div className="meter"><i style={{ width: `${filled * 100}%` }} /></div>
              <p className="muted small">
                {c.status === 0 && `${c.memberCount}/${c.maxMembers} joined · ${c.maxMembers - Number(c.memberCount)} seats left`}
                {c.status === 1 && `Round ${Number(c.currentRound) + 1} of ${c.maxMembers} · ${c.paidCount}/${c.activeCount} paid`}
                {c.status === 2 && `Finished · ${c.maxMembers} payouts`}
                {c.status === 3 && "Cancelled"}
              </p>
            </Link>
          );
        })}
      </div>
    </>
  );
}
