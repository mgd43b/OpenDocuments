---
"opendocuments": minor
"opendocuments-server": minor
---

Add the Slack connector (`@opendocuments/connector-slack`). It indexes one document per public channel, rendered as a chronological transcript with resolved author names, thread replies, and attachment text. Configure it with `{ type: 'slack', token, channels }` in `opendocuments.config.ts`, from the Web UI connectors page, or via `SLACK_TOKEN`.
