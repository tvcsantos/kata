---
layout: home

hero:
  name: kata
  text: One config for all your AI agents
  tagline: Write instructions and MCP servers once - compile them into CLAUDE.md, .mcp.json, and every other harness's native format.
  image:
    src: /images/kata-800.png
    alt: kata
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: What is kata?
      link: /guide/what-is-kata

features:
  - icon: 🗂️
    title: One source of truth
    details: A tool-agnostic .kata/ directory holds your instructions and MCP server definitions. Adapters render them for each tool.
  - icon: 🔍
    title: Plan before apply
    details: Terraform-style workflow - kata plan shows exact file diffs per target; kata apply writes them. Deterministic and idempotent.
  - icon: ✍️
    title: Respects hand edits
    details: Markdown gets a clearly-marked managed region; JSON is merged, not overwritten. Your content outside the managed parts survives every apply.
  - icon: 🔐
    title: No inlined secrets
    details: Reference secrets as ${env:VAR} in your .kata/ files. Adapters render each tool's native env expansion - keys never land in committed files.
---
