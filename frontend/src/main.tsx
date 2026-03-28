import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { env } from "./shared/config/env";
import "./styles.css";

async function bootstrap() {
  if (env.enableMocks) {
    const { worker } = await import("./mocks/browser");
    await worker.start({
      onUnhandledRequest: "bypass",
    });
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
