import "./globals.css";
import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { headers } from "next/headers";
import { AppShell } from "../components/nav";
import { authenticatedUser } from "../lib/auth";
import { listSkills } from "../lib/data";

// One superfamily: Plex Sans carries the interface, Plex Mono is reserved for
// machine-produced values — IDs, checksums, paths, YAML, diffs — so a
// monospaced run always means "this came from the system".
const ui = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-plex-sans",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "SkillEd — Skill evaluation workbench",
  description:
    "Build evidence-backed evals, test Skills, and verify improvements.",
};
export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const requestHeaders = await headers();
  const currentUser = authenticatedUser(
    new Request("http://skilled.local", { headers: requestHeaders }),
  );
  const skills = await listSkills();
  return (
    <html lang="en" className={`${ui.variable} ${mono.variable}`}>
      <body>
        <AppShell skills={skills} currentUser={currentUser}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
