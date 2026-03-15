import { type PropsWithChildren } from "react";
import { Link } from "react-router-dom";

type AppShellProps = PropsWithChildren<{
  title: string;
  subtitle: string;
}>;

export function AppShell({ title, subtitle, children }: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero__texture" />
        <nav className="topnav">
          <Link to="/projects">Projects</Link>
          <a href="http://localhost:8080/api/v1/projects" target="_blank" rel="noreferrer">
            API
          </a>
        </nav>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
