import { defineConfig } from "vitepress";
const base = process.env.SKILLED_DOCS_BASE || "/";
const entries = (prefix: string, chinese: boolean) => [
  {
    text: chinese ? "入门" : "Start",
    items: [
      {
        text: chinese ? "品牌与安装" : "Branding and installation",
        link: `${prefix}/guide/installation`,
      },
      {
        text: chinese ? "快速上手" : "Getting started",
        link: `${prefix}/guide/getting-started`,
      },
      {
        text: chinese ? "Windows 与平台状态" : "Windows and platform status",
        link: `${prefix}/guide/windows`,
      },
    ],
  },
  {
    text: chinese ? "参考" : "Reference",
    items: [
      {
        text: chinese ? "编写评测" : "Writing evaluations",
        link: `${prefix}/guide/writing-evals`,
      },
      {
        text: chinese ? "CLI 命令" : "CLI commands",
        link: `${prefix}/guide/cli-reference`,
      },
      {
        text: chinese ? "用户配置" : "User configuration",
        link: `${prefix}/guide/user-config`,
      },
      {
        text: chinese ? "迁移说明" : "Migration",
        link: `${prefix}/guide/migration`,
      },
      {
        text: chinese ? "CI 维护" : "CI maintenance",
        link: `${prefix}/guide/ci-maintenance`,
      },
    ],
  },
];
export default defineConfig({
  base,
  title: "skilled",
  description: "Evaluate Agent Skills, agents and workspaces.",
  cleanUrls: true,
  ignoreDeadLinks: false,
  head: [["link", { rel: "icon", href: `${base}logo.svg` }]],
  themeConfig: {
    logo: "/logo.svg",
    search: { provider: "local" },
    socialLinks: [{ icon: "github", link: "https://github.com/DeadHead04/skillEd" }],
  },
  locales: {
    root: {
      label: "English",
      lang: "en-US",
      themeConfig: {
        nav: [
          { text: "Guide", link: "/guide/getting-started" },
          { text: "CLI reference", link: "/guide/cli-reference" },
        ],
        sidebar: entries("", false),
        footer: {
          message:
            "Apache-2.0. TypeScript development version. Source: DeadHead04/skillEd.",
          copyright:
            "Original copyright © Alibaba Group; license notices retained.",
        },
      },
    },
    zh: {
      label: "简体中文",
      lang: "zh-CN",
      link: "/zh/",
      themeConfig: {
        nav: [
          { text: "指南", link: "/zh/guide/getting-started" },
          { text: "CLI 参考", link: "/zh/guide/cli-reference" },
        ],
        sidebar: entries("/zh", true),
        footer: {
          message: "Apache-2.0。TypeScript 开发版本。源码：DeadHead04/skillEd。",
          copyright: "保留 Alibaba Group 原始版权声明。",
        },
        outline: { label: "本页内容" },
        docFooter: { prev: "上一页", next: "下一页" },
        darkModeSwitchLabel: "主题",
        sidebarMenuLabel: "菜单",
        returnToTopLabel: "回到顶部",
      },
    },
  },
});
