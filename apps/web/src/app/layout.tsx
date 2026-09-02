import "./globals.css";
import type { Metadata } from "next";
import { Nav } from "../components/nav";
export const metadata: Metadata = {
  title: "SkillEd — Skill evaluation workbench",
  description:
    "Build evidence-backed evals, test Skills, and verify improvements.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="app">
          <Nav />
          <main className="main">
            <header className="topbar">
              <div className="context">
                One Skill lineage · local trusted mode
              </div>
              <div className="status">
                <span className="dot" />
                Sequential worker
              </div>
            </header>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
