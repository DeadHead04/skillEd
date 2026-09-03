import "./globals.css";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { AppShell } from "../components/nav";
import { authenticatedUser } from "../lib/auth";
import { listSkills } from "../lib/data";
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
    <html lang="en">
      <body>
        <AppShell skills={skills} currentUser={currentUser}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
