import { type PropsWithChildren } from "react";
import { Link } from "react-router-dom";
import { env } from "../config/env";
import { t } from "../i18n";

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
          <Link to="/projects">{t.appShell.navProjects}</Link>
          <a href={`${env.apiBaseUrl}/projects`} target="_blank" rel="noreferrer">
            API
          </a>
        </nav>
        <div className="hero__meta">
          <span className="eyebrow">{t.appShell.title}</span>
          <span className="runtime-badge">
            {env.enableMocks ? t.appShell.mockMode : t.appShell.liveMode}
          </span>
        </div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
