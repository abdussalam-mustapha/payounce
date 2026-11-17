import { NavLink, Route, Routes } from "react-router-dom";
import { ConnectButton } from "./components/ConnectButton";
import { Logo } from "./components/Logo";
import { Home } from "./pages/Home";
import { CreateCircle } from "./pages/CreateCircle";
import { CircleView } from "./pages/CircleView";
import { Passport } from "./pages/Passport";
import { useConnection } from "wagmi";
import { activeChain, factoryAddress } from "./lib/chains";

export default function App() {
  const { address } = useConnection();
  return (
    <div className="shell">
      <header className="topbar">
        <Logo />
        <nav>
          <NavLink to="/" end className="navlink">Circles</NavLink>
          <NavLink to="/create" className="navlink">Start a circle</NavLink>
          {address && <NavLink to={`/u/${address}`} className="navlink">Passport</NavLink>}
          <ConnectButton />
        </nav>
      </header>
      {!/^0x[0-9a-fA-F]{40}$/.test(factoryAddress) && (
        <p className="banner">Set VITE_FACTORY_ADDRESS in web/.env (see .env.example).</p>
      )}
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/create" element={<CreateCircle />} />
          <Route path="/c/:address" element={<CircleView />} />
          <Route path="/u/:address" element={<Passport />} />
        </Routes>
      </main>
      <footer className="foot">
        <span>Payounce · savings circles on QIE</span>
        <span className="net"><i />{activeChain.name}</span>
      </footer>
    </div>
  );
}
