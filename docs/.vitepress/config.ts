import { defineConfig } from "vitepress";

const base = process.env.SKILLED_DOCS_BASE || "/";

export default defineConfig({
  base,
  title: "skilled",
  description: "Evaluate Agent Skills, agents and workspaces.",
  lang: "en-US",
  cleanUrls: true,
  ignoreDeadLinks: false,
  head: [["link", { rel: "icon", href: `${base}logo.svg` }]],
  themeConfig: {
    logo: "/logo.svg",
    search: { provider: "local" },
    socialLinks: [{ icon: "github", link: "https://github.com/DeadHead04/skillEd" }],
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "CLI reference", link: "/guide/cli-reference" },
    ],
    sidebar: [
      {
        text: "Start",
        items: [
          { text: "Installation", link: "/guide/installation" },
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "Windows and platform status", link: "/guide/windows" },
          { text: "Verification and release scope", link: "/verification" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Writing evaluations", link: "/guide/writing-evals" },
          { text: "CLI commands", link: "/guide/cli-reference" },
          { text: "User configuration", link: "/guide/user-config" },
          { text: "Migration", link: "/guide/migration" },
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
