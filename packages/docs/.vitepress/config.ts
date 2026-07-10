import { withMermaid } from "vitepress-plugin-mermaid";

export default withMermaid({
  title: "kata",
  description: "One tool to configure all your AI harnesses / agents",
  // Served from a GitHub Pages project path: https://tvcsantos.github.io/kata/
  base: "/kata/",
  themeConfig: {
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
    socialLinks: [{ icon: "github", link: "https://github.com/tvcsantos/kata" }],
    search: { provider: "local" },
    footer: {
      message: "Released under the MIT License.",
    },
  },
});
