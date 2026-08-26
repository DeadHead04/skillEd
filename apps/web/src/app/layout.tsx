import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "SkillEd", template: "%s · SkillEd" },
  description: "Import, validate, and inspect Agent Skills.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
