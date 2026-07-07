import { SKILL_MD_NAME } from "@katahq/core";
import { MCP_SERVERS_SCHEMA_VERSION } from "../../core/dist/schema.js";
import { KATA_APPLY_HINT } from "./hints.js";

export const INSTRUCTION_TEMPLATE = `<!-- Instructions compose into every harness's context, in file-name order. -->

Write your guidance here.
`;

export const PROMPT_TEMPLATE = (description: string) => `---
description: ${description}
---

Write the prompt here. Use $ARGUMENTS where the user's input goes.
`;

export const AGENT_TEMPLATE = (description: string) => `---
description: ${description}
---

Describe the subagent's role and how it should work.
`;

export const SKILL_TEMPLATE = (name: string, description: string) => `---
name: ${name}
description: ${description}
---

Write the skill's instructions here. Supporting files can live alongside ${SKILL_MD_NAME}.
`;

export const MCP_SERVERS_EMPTY_TEMPLATE = `version: ${MCP_SERVERS_SCHEMA_VERSION}
servers: {}
`;

export const SAMPLE_INSTRUCTIONS = `# Project instructions

Shared instructions for every AI harness used in this project.
Write them once here; \`${KATA_APPLY_HINT(false)}\` renders them into CLAUDE.md,
AGENTS.md, and friends.
`;

export const SAMPLE_GLOBAL_INSTRUCTIONS = `# Global instructions

Personal instructions for every AI harness, in every project.
Write them once here; \`${KATA_APPLY_HINT(true)}\` renders them into
~/.claude/CLAUDE.md, ~/.codex/AGENTS.md, and friends.
`;

export const SAMPLE_SERVERS = `version: ${MCP_SERVERS_SCHEMA_VERSION}
servers: {}
# Example:
#   github:
#     transport: stdio
#     command: npx
#     args: ["-y", "@modelcontextprotocol/server-github"]
#     env:
#       GITHUB_PERSONAL_ACCESS_TOKEN: \${env:GITHUB_TOKEN}
`;
