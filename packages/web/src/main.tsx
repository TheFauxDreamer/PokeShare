import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PairsView } from "./views/PairsView.js";
import { PlayView } from "./views/PlayView.js";
import { StreamView } from "./views/StreamView.js";
import "./styles.css";

/**
 * Routing is a switch on the pathname. Three fixed routes do not justify a
 * router dependency, and OBS browser sources want plain URLs anyway:
 *
 *   /play?run=K7QP2M    /stream?run=K7QP2M    /pairs?run=K7QP2M
 */
function App() {
  const path = globalThis.location.pathname.replace(/\/+$/, "");
  const joinCode = new URLSearchParams(globalThis.location.search)
    .get("run")
    ?.toUpperCase();

  switch (path) {
    case "/stream":
      return <StreamView joinCode={joinCode ?? undefined} />;
    case "/pairs":
      return <PairsView joinCode={joinCode ?? undefined} />;
    case "/play":
      return <PlayView joinCode={joinCode ?? undefined} />;
    default:
      return (
        <div className="landing">
          <h1>PokeShare</h1>
          <p>Browser Soul Link Nuzlocke for Gen 3.</p>
          <ul>
            <li>
              <a href="/play">/play</a> — start or join a run and play
            </li>
            <li>
              <a href="/stream">/stream</a> — the OBS browser source
            </li>
            <li>
              <a href="/pairs">/pairs</a> — every pair, status and route
            </li>
          </ul>
        </div>
      );
  }
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
