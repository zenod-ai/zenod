import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import App from "./App";

declare const __PHYLAX_WEB_BUILD_ID__: string;

document.documentElement.dataset.phylaxBuild = __PHYLAX_WEB_BUILD_ID__;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider storageKey="phylax.theme">
      <App />
      <Toaster />
    </ThemeProvider>
  </StrictMode>,
);
