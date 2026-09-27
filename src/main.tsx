import { createRoot } from "react-dom/client";
import { worldReady } from "./loader";

// Placeholder until the game is built (BRIEF.md).
const root = document.getElementById("root");
if (root) createRoot(root).render(<main style={{ padding: 24 }}>Under construction.</main>);
requestAnimationFrame(() => worldReady());
