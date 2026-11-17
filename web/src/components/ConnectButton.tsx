import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { useEffect, useRef, useState } from "react";
import { activeChain } from "../lib/chains";
import { shortAddr } from "../lib/format";
import { Avatar } from "./Avatar";

export function ConnectButton() {
  const { address, isConnected, chainId } = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const switchChain = useSwitchChain();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (isConnected && chainId !== activeChain.id) {
    return (
      <button className="btn warn sm" onClick={() => switchChain.mutate({ chainId: activeChain.id })}>
        Switch to {activeChain.name}
      </button>
    );
  }

  if (isConnected && address) {
    return (
      <div className="connect" ref={ref}>
        <button className="wallet-chip" onClick={() => setOpen((o) => !o)}>
          <Avatar address={address} size={22} />
          <span className="mono">{shortAddr(address)}</span>
        </button>
        {open && (
          <div className="menu">
            <button onClick={() => navigator.clipboard.writeText(address)}>Copy address</button>
            <button onClick={() => { disconnect.mutate(); setOpen(false); }}>Disconnect</button>
          </div>
        )}
      </div>
    );
  }

  // QIE Wallet first when installed.
  const sorted = [...connectors].sort((a, b) => Number(b.id === "me.qiewallet") - Number(a.id === "me.qiewallet"));

  return (
    <div className="connect" ref={ref}>
      <button className="btn sm" onClick={() => setOpen((o) => !o)}>Connect wallet</button>
      {open && (
        <div className="menu">
          <p className="menu-label">Choose a wallet</p>
          {sorted.map((c) => (
            <button
              key={c.uid}
              onClick={() => {
                connect.mutate({ connector: c, chainId: activeChain.id });
                setOpen(false);
              }}
            >
              {c.icon ? <img src={c.icon} alt="" width={20} height={20} /> : <span className="wallet-ph" />}
              {c.name}
              {c.id === "me.qiewallet" && <span className="tag">Recommended</span>}
            </button>
          ))}
          {sorted.length === 0 && <p className="muted small pad">No wallet found. Install QIE Wallet.</p>}
        </div>
      )}
    </div>
  );
}
