import { defineConfig } from "vitepress";

const base = process.env.SKILLED_DOCS_BASE || "/";
// Canonical identity stays on the published site, including during local previews.
const siteUrl = "https://deadhead04.github.io/skillEd/";
const repositoryUrl = "https://github.com/DeadHead04/skillEd";
const description = "skilled is an open-source agent skill evaluation CLI and MCP server for Codex and Claude Code. Test skills, detect regressions, and improve with evidence.";

export default defineConfig({
  base,
  title: "skilled",
  description,
  lang: "en-US",
  cleanUrls: true,
  ignoreDeadLinks: false,
  head: [["link", { rel: "icon", href: `${base}logo.svg` }]],
  sitemap: { hostname: siteUrl },
  transformHead({ pageData }) {
    if (pageData.relativePath === "404.md") {
      return [["meta", { name: "robots", content: "noindex" }]];
    }
    const path = pageData.relativePath
      .replace(/(^|\/)index\.md$/, "$1")
      .replace(/\.md$/, "");
    const url = new URL(path, siteUrl).href;
    const title = pageData.frontmatter.titleTemplate === false
      ? pageData.title
      : pageData.title ? `${pageData.title} | skilled` : "skilled";
    const pageDescription = pageData.description || description;
    const head: import("vitepress").HeadConfig[] = [
      ["link", { rel: "canonical", href: url }],
      ["meta", { property: "og:type", content: "website" }],
      ["meta", { property: "og:site_name", content: "skilled" }],
      ["meta", { property: "og:title", content: title }],
      ["meta", { property: "og:description", content: pageDescription }],
      ["meta", { property: "og:url", content: url }],
      ["meta", { name: "twitter:card", content: "summary" }],
      ["meta", { name: "twitter:title", content: title }],
      ["meta", { name: "twitter:description", content: pageDescription }],
    ];
    if (pageData.relativePath === "index.md") {
      head.push(["script", { type: "application/ld+json" }, JSON.stringify({
        "@context": "https://schema.org",
        "@type": "SoftwareSourceCode",
        name: "skilled",
        description,
        url: siteUrl,
        codeRepository: repositoryUrl,
        programmingLanguage: "TypeScript",
        license: "https://www.apache.org/licenses/LICENSE-2.0",
        runtimePlatform: "Node.js",
      })]);
    }
    return head;
  },
  themeConfig: {
    logo: "/logo.svg",
    search: { provider: "local" },
    socialLinks: [{ icon: "github", link: "https://github.com/DeadHead04/skillEd" }],
    nav: [
      { text: "Get started", link: "/guide/getting-started" },
      { text: "See it work", link: "/guide/see-it-work" },
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
          { text: "See it work", link: "/guide/see-it-work" },
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
