import { type PropsWithChildren } from "react";
import { Link } from "react-router-dom";
import { env } from "../config/env";

type AppShellProps = PropsWithChildren<{
  title: string;
  subtitle: string;
}>;

export function AppShell({ title, subtitle, children }: AppShellProps) {
  return (
    <div className="app-shell">
      <div className="app-shell__ambient" />
      <header className="hero">
        <div className="hero__noise" />
        <nav className="topnav">
          <Link to="/projects">Projects</Link>
          <a href={`${env.apiBaseUrl}/projects`} target="_blank" rel="noreferrer">
            API
          </a>
        </nav>
        <div className="hero__meta">
          <span className="eyebrow">Mimir RAG Console</span>
          <span className="runtime-badge">
            {env.enableMocks ? "Mock switch on" : "Live backend"}
          </span>
        </div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
