import { withMermaid } from "vitepress-mermaid-viewer";
import llmstxt, { copyOrDownloadAsMarkdownButtons } from "vitepress-plugin-llms";

export default withMermaid({
  title: "kata",
  description: "One tool to configure all your AI harnesses / agents",
  // Served from a GitHub Pages project path: https://tvcsantos.github.io/kata/
  base: "/kata/",
  head: [["link", { rel: "icon", href: `/kata/favicon.ico` }]],
  vite: {
    plugins: [llmstxt() as any],
  },
  markdown: {
    config(md) {
      md.use(copyOrDownloadAsMarkdownButtons);
    },
  },
  themeConfig: {
    logo: "/images/kata-logo-200.png",
    nav: [
      { text: "Guide", link: "/guide/what-is-kata" },
      { text: "Reference", link: "/reference/cli" },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "Guide",
          items: [
            { text: "What is kata?", link: "/guide/what-is-kata" },
            { text: "Getting started", link: "/guide/getting-started" },
            { text: "Kata format", link: "/guide/kata-format" },
            { text: "Managed files", link: "/guide/managed-files" },
            { text: "Sharing & packages", link: "/guide/sharing" },
          ],
        },
      ],
      "/reference/": [
        {
          text: "Reference",
          items: [
            { text: "CLI commands", link: "/reference/cli" },
            { text: "Configuration schema", link: "/reference/config" },
            { text: "Adapters", link: "/reference/adapters" },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/tvcsantos/kata" },
      { icon: "npm", link: "https://www.npmjs.com/package/@katahq/cli" },
    ],
    editLink: {
      pattern: "https://github.com/tvcsantos/kata/edit/main/packages/docs/:path",
      text: "Edit this page on GitHub",
    },
    search: { provider: "local" },
    footer: {
      message: "Released under the MIT License.",
    },
  },
});
