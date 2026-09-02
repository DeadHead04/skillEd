import "./globals.css";
import type { Metadata } from "next";
import { AppShell } from "../components/nav";
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
  const skills = await listSkills();
  return (
    <html lang="en">
      <body>
        <AppShell skills={skills}>{children}</AppShell>
      </body>
    </html>
  );
}
