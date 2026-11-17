import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useConnection, usePublicClient, useWriteContract } from "wagmi";
import { parseEventLogs, parseUnits, zeroAddress } from "viem";
import { payounceFactoryAbi } from "../lib/abi";
import { factoryAddress } from "../lib/chains";
import { errMsg, fmtUsd, periodLabel } from "../lib/format";
import { Dial } from "../components/Dial";

const PERIODS = [
  { label: "10 min", hint: "testing", s: 600 },
  { label: "Daily", s: 86_400 },
  { label: "Weekly", s: 604_800 },
  { label: "Monthly", s: 2_592_000 },
];
type Mode = "usd" | "qie" | "token";

function Seg<T extends string | number | boolean>({ value, options, onChange }: { value: T; options: { v: T; label: string; hint?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg full">
      {options.map((o) => (
        <button type="button" key={String(o.v)} className={value === o.v ? "on" : ""} onClick={() => onChange(o.v)}>
          {o.label}
          {o.hint && <small>{o.hint}</small>}
        </button>
      ))}
    </div>
  );
}

export function CreateCircle() {
  const navigate = useNavigate();
  const { isConnected } = useConnection();
  const client = usePublicClient();
  const write = useWriteContract();

  const [name, setName] = useState("");
  const [mode, setMode] = useState<Mode>("usd");
  const [amount, setAmount] = useState("25");
  const [tokenAddr, setTokenAddr] = useState("");
  const [members, setMembers] = useState(5);
  const [period, setPeriod] = useState(604_800);
  const [useRep, setUseRep] = useState(true);
  const [premium, setPremium] = useState(200);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [joinDays, setJoinDays] = useState(3);
  const [error, setError] = useState<string>();
  const [stage, setStage] = useState<"idle" | "sign" | "confirm">("idle");

  const amt = Number(amount) || 0;
  const money = (x: number) => (mode === "usd" ? fmtUsd(x) : `${x.toLocaleString()} ${mode === "qie" ? "QIE" : "tokens"}`);
  const per = periodLabel(period);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    try {
      setStage("sign");
      const token = mode === "token" ? (tokenAddr as `0x${string}`) : zeroAddress;
      const contribution = mode === "usd" ? BigInt(Math.round(amt * 100)) : parseUnits(amount, 18);
      const hash = await write.mutateAsync({
        address: factoryAddress,
        abi: payounceFactoryAbi,
        functionName: "createCircle",
        args: [
          {
            name: name.trim(),
            token,
            contribution,
            usdPriced: mode === "usd",
            period: BigInt(period),
            maxMembers: members,
            joinWindow: BigInt(Math.round(joinDays * 86_400)),
            useReputation: useRep,
            requireVerified: verifiedOnly,
            premiumBps: premium,
          },
        ],
      });
      setStage("confirm");
      const receipt = await client!.waitForTransactionReceipt({ hash });
      const [created] = parseEventLogs({ abi: payounceFactoryAbi, logs: receipt.logs, eventName: "CircleCreated" });
      navigate(`/c/${created.args.circle}`);
    } catch (err) {
      setError(errMsg(err));
      setStage("idle");
    }
  }

  const seatRows = Array.from({ length: members }, (_, k) => {
    const steps = members - 1 - k;
    return { k, owed: amt * steps, prem: (amt * premium * steps) / 10_000 };
  });
  const premiumPool = seatRows.reduce((s, r) => s + r.prem, 0);
  const weightSum = (members * (members - 1)) / 2;

  return (
    <div className="create">
      <form className="create-form" onSubmit={submit}>
        <span className="eyebrow">New circle</span>
        <h1 className="display">Set up your circle</h1>

        <div className="field">
          <label htmlFor="name">Name</label>
          <input id="name" required maxLength={64} value={name} onChange={(e) => setName(e.target.value)} placeholder="Family savings circle" />
        </div>

        <div className="field">
          <label>Pay in</label>
          <Seg<Mode>
            value={mode}
            onChange={setMode}
            options={[
              { v: "usd", label: "USD", hint: "paid in QIE" },
              { v: "qie", label: "QIE", hint: "fixed" },
              { v: "token", label: "Token", hint: "ERC-20" },
            ]}
          />
          {mode === "usd" && <p className="hint">Members pay the USD amount in QIE at the live QIE Oracle price, so savers in any country agree on the same number.</p>}
        </div>

        {mode === "token" && (
          <div className="field">
            <label htmlFor="tok">Token address</label>
            <input id="tok" className="mono" required pattern="^0x[0-9a-fA-F]{40}$" value={tokenAddr} onChange={(e) => setTokenAddr(e.target.value)} placeholder="0x…" />
          </div>
        )}

        <div className="field">
          <label htmlFor="amt">Contribution per round</label>
          <div className="money-input">
            {mode === "usd" && <span>$</span>}
            <input id="amt" required type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            {mode !== "usd" && <span>{mode === "qie" ? "QIE" : "tokens"}</span>}
          </div>
        </div>

        <div className="field">
          <label>Round length</label>
          <Seg<number> value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ v: p.s, label: p.label, hint: p.hint }))} />
        </div>

        <div className="field">
          <label htmlFor="mem">Seats <span className="muted">· also the number of rounds</span></label>
          <div className="stepper">
            <button type="button" onClick={() => setMembers((m) => Math.max(2, m - 1))} aria-label="Fewer seats">−</button>
            <input id="mem" type="number" min={2} max={50} value={members} onChange={(e) => setMembers(Math.min(50, Math.max(2, Number(e.target.value))))} />
            <button type="button" onClick={() => setMembers((m) => Math.min(50, m + 1))} aria-label="More seats">+</button>
          </div>
        </div>

        <div className="field">
          <label>Track record</label>
          <Seg<boolean>
            value={useRep}
            onChange={setUseRep}
            options={[
              { v: true, label: "Reward it", hint: "up to 50% off" },
              { v: false, label: "Full collateral", hint: "maximum safety" },
            ]}
          />
          <p className="hint">
            {useRep
              ? "Members who finished earlier circles cleanly lock 25% less per circle (up to 50%) for early seats."
              : "Every early seat locks the full amount it still owes. No member can ever leave the group short."}
          </p>
        </div>

        <div className="field">
          <label>Early-seat premium</label>
          <Seg<number>
            value={premium}
            onChange={setPremium}
            options={[
              { v: 0, label: "None", hint: "classic" },
              { v: 100, label: "1%", hint: "per seat" },
              { v: 200, label: "2%", hint: "per seat" },
              { v: 500, label: "5%", hint: "per seat" },
            ]}
          />
          <p className="hint">
            {premium === 0
              ? "Everyone receives the full pot."
              : "Early seats get cash sooner, so they give a small share of their payout to the later seats who waited. Savers earn; nobody sets an interest rate."}
          </p>
        </div>

        <div className="field">
          <label>Who can join</label>
          <Seg<boolean>
            value={verifiedOnly}
            onChange={setVerifiedOnly}
            options={[
              { v: false, label: "Anyone with the link" },
              { v: true, label: "QIE ID verified", hint: "real people only" },
            ]}
          />
        </div>

        <div className="field">
          <label htmlFor="jd">Open for joining</label>
          <div className="money-input">
            <input id="jd" type="number" min={0.01} step="0.5" value={joinDays} onChange={(e) => setJoinDays(Number(e.target.value))} />
            <span>days</span>
          </div>
        </div>

        {error && <p className="error">{error}</p>}
        <button className="btn lg block" disabled={!isConnected || stage !== "idle"}>
          {!isConnected ? "Connect a wallet to continue" : stage === "sign" ? "Confirm in your wallet…" : stage === "confirm" ? "Creating circle…" : "Create circle"}
        </button>
      </form>

      <aside className="preview">
        <div className="preview-card">
          <span className="eyebrow">Preview</span>
          <h2 className="display sm">{name.trim() || "Your circle"}</h2>
          <div className="preview-dial">
            <Dial
              seats={Array.from({ length: members }, (_, i) => ({ state: i === 0 ? "current" : "open" }))}
              size={200}
              compact
              center={
                <>
                  <span className="eyebrow">Each payout</span>
                  <span className="pot sm">{money(amt * members)}</span>
                </>
              }
            />
          </div>
          <ul className="facts">
            <li><span>Everyone pays</span><b>{money(amt)} / {per}</b></li>
            <li><span>Circle runs for</span><b>{members} rounds</b></li>
          </ul>
          <div className="seat-table">
            <div className="seat-row head"><span>Seat</span><span>Receives</span><span>Locks</span></div>
            {seatRows.slice(0, 8).map(({ k, owed, prem }) => {
              const earn = weightSum ? (premiumPool * k) / weightSum : 0;
              const net = amt * members - prem + earn;
              return (
                <div key={k} className="seat-row">
                  <span className="mono">{String(k + 1).padStart(2, "0")}</span>
                  <span>
                    {money(Math.round(net * 100) / 100)} <span className="muted small">· round {k + 1}</span>
                  </span>
                  <b>{owed === 0 ? "Nothing" : money(owed)}</b>
                </div>
              );
            })}
            {members > 8 && <div className="seat-row more muted">+ {members - 8} more seats</div>}
          </div>
          <p className="hint">Each seat locks what it still owes after collecting the pot, so nobody can take the money and run.</p>
        </div>
      </aside>
    </div>
  );
}
