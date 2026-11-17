import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { BrowserRouter } from "react-router-dom";
import { config, devAccount } from "./lib/wagmi";
import { connect } from "wagmi/actions";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient();

if (devAccount) connect(config, { connector: config.connectors[0] }).catch(console.error);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
