import { defineConfig } from "vitepress";

const base = process.env.SKILLED_DOCS_BASE || "/";

export default defineConfig({
  base,
  title: "skilled",
  description: "Test agent skills, compare results, and improve with evidence. A TypeScript CLI with bundled MCP tools and the skilled-improve workflow.",
  lang: "en-US",
  cleanUrls: true,
  ignoreDeadLinks: false,
  head: [["link", { rel: "icon", href: `${base}logo.svg` }]],
  themeConfig: {
    logo: "/logo.svg",
    search: { provider: "local" },
    socialLinks: [{ icon: "github", link: "https://github.com/DeadHead04/skillEd" }],
    nav: [
      { text: "Get started", link: "/guide/getting-started" },
      { text: "Use with your agent", link: "/guide/mcp" },
      { text: "CLI reference", link: "/guide/cli-reference" },
      { text: "Releases", link: "https://github.com/DeadHead04/skillEd/releases" },
    ],
    sidebar: [
      {
        text: "Start here",
        items: [
          { text: "Installation", link: "/guide/installation" },
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "Use with MCP", link: "/guide/mcp" },
        ],
      },
      {
        text: "Evaluate and improve",
        items: [
          { text: "Writing evaluations", link: "/guide/writing-evals" },
          { text: "Compare results", link: "/guide/comparison" },
          { text: "Scoring contract", link: "/guide/scoring" },
          { text: "Import existing cases", link: "/guide/migration" },
        ],
      },
      {
        text: "Reference and verification",
        items: [
          { text: "CLI commands", link: "/guide/cli-reference" },
          { text: "User configuration", link: "/guide/user-config" },
          { text: "Platform status", link: "/guide/windows" },
          { text: "Verification and release scope", link: "/verification" },
          { text: "CI maintenance", link: "/guide/ci-maintenance" },
        ],
      },
    ],
    footer: {
      message:
        "Apache-2.0. TypeScript CLI. Source: DeadHead04/skillEd.",
      copyright:
        "Original copyright © Alibaba Group; license notices retained.",
    },
  },
});
