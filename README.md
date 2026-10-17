# memory-keeper

[![Version](https://img.shields.io/badge/version-0.2.4-blue)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-%E2%89%A5%202.1.290-orange)](https://claude.com/claude-code)

A Claude Code plugin that gives every project a structured, self-maintaining memory. It keeps a `.claude/memory/` folder up to date on a schedule and shows it in a live, colour-coded pane inside Claude Code.

---

## Table of contents

- [Overview](#overview)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Commands](#commands)
- [Configuration](#configuration)
- [Memory layout](#memory-layout)
- [How syncing works](#how-syncing-works)
- [Privacy and cost](#privacy-and-cost)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Project structure](#project-structure)
- [Contributing](#contributing)
- [License](#license)

## Overview

Claude Code starts every session with a blank slate apart from `CLAUDE.md`. memory-keeper turns `.claude/` into a durable project memory:

- `CLAUDE.md` is loaded automatically and imports a small index (`memory/MEMORY.md`).
- Detailed notes live in typed folders (sessions, decisions, context, references), read only when relevant.
- The plugin keeps the session log and the index current without you having to ask, and lets you see the whole memory at a glance.

## Features

| Feature | Description |
|---|---|
| **Live Memory pane** | Colour-coded tree of every memory folder with file sizes and relative ages. Files changed in the last 10 minutes are highlighted. Shows this session's activity and offers **Sync now** / **Refresh** buttons. |
| **Scheduled sync** | Every *N* minutes (default 10), at session end, and on demand. |
| **Session summaries** | Asks the model for a concise *Done / Decisions / Open threads* summary of the session and writes it into the session file. Runs only when new prompts have arrived. |
| **Activity log** | Records tool calls, shell commands and files edited during the session. |
| **Index maintenance** | Rebuilds `MEMORY.md` from the folders, preserving any hand-written descriptions. |
| **Safe writes** | Automatic content is confined to `<!-- auto:… -->` marker blocks; text outside them is never modified. |
| **One-command setup** | `/memory-init` scaffolds the layout in any project without overwriting existing files. |

## Requirements

- [Claude Code](https://claude.com/claude-code) **2.1.290 or later** (function-hook plugins).
- Terminal or the Claude Code desktop app. The pane opens automatically in terminals at least **144 columns** wide; in narrower terminals open it with `/memory`.

> **Note:** the Claude Code function-hook plugin API is in early access and may change between releases.

## Installation

### From GitHub (recommended)

At the Claude Code prompt:

```
/plugin install memory-keeper --marketplace ayushabrol13/memory-keeper
```

Answer `y` to add the marketplace, choose the **user** scope to enable it in every project, and set the options when prompted (or accept the defaults).

Or from a shell:

```bash
claude plugin marketplace add ayushabrol13/memory-keeper
claude plugin install memory-keeper@memory-keeper
```

### From a local clone

```bash
git clone https://github.com/ayushabrol13/memory-keeper.git ~/claude-plugins/memory-keeper
claude plugin marketplace add ~/claude-plugins/memory-keeper
claude plugin install memory-keeper@memory-keeper
```

A local-folder marketplace is read directly from disk, so edits take effect after `/reload-plugins`.

### Updating and uninstalling

```bash
claude plugin update memory-keeper@memory-keeper
claude plugin uninstall memory-keeper@memory-keeper
```

## Quick start

1. Open Claude Code in your project.
2. Run `/memory-init` to create the memory layout.
3. Run `/memory` to open the pane.
4. Work as usual. The session file and index update every 10 minutes; press **Sync now** or run `/memory-sync` at any time.

## Commands

| Command | Action |
|---|---|
| `/memory` | Open the Memory pane. |
| `/memory-sync` | Sync immediately: write a fresh summary, update activity and rebuild the index. |
| `/memory-init` | Create `.claude/CLAUDE.md`, `.claude/memory/MEMORY.md` and the four folders. Existing files are left untouched. |

## Configuration

Set options during installation, with `/plugin configure memory-keeper@memory-keeper`, or in `/config`.

| Option | Type | Default | Description |
|---|---|---|---|
| `intervalMinutes` | number | `10` | Minutes between automatic syncs (minimum 1). |
| `summarize` | boolean | `true` | Write a model-generated session summary on automatic syncs. `/memory-sync` always summarizes. |

## Memory layout

```
.claude/
├── CLAUDE.md                 # loaded at session start; imports the index
└── memory/
    ├── MEMORY.md             # index: one line per memory file
    ├── sessions/             # one file per session: what happened, open threads
    ├── decisions/            # one file per decision, with the reasoning
    ├── context/              # current state: tools, configuration, quirks
    └── references/           # pointers to external docs, repos, dashboards
```

Session files are matched to a session by an HTML comment such as `<!-- session:<session-id> -->`. If none exists, memory-keeper creates `sessions/<YYYY-MM-DD>-<id8>.md`. Add the marker to an existing file to have the plugin write there instead.

## How syncing works

Each sync performs these steps:

1. **Scan** the four memory folders.
2. **Locate** the current session's file (or create it).
3. **Summarize** (if enabled and new prompts have arrived): a single tool-less model call over the session transcript, written to the `auto:summary` block.
4. **Record activity** in the `auto:activity` block: user turns, tool calls, shell commands and edited files.
5. **Rebuild** `MEMORY.md`. Existing entries keep their descriptions; new files are added using their first heading as the title.

Example of the blocks written to a session file:

```markdown
<!-- auto:summary:start -->
## Auto summary

### Done
- 2026-10-17: Added rate limiting to the public API.
...
<!-- auto:summary:end -->

<!-- auto:activity:start -->
## Auto activity

_Last synced 2026-10-17 13:38 · 19 user turns · 48 tool calls · 12 shell commands_
...
<!-- auto:activity:end -->
```

## Privacy and cost

- **Local only.** All files are written to your project's `.claude/` folder; writes that would resolve outside it (for example through a symbolic link) are refused. Nothing is sent anywhere except the summary request below.
- **Summaries use your Claude session.** Each summary is one extra model request over the conversation, served largely from the prompt cache. It runs only when new prompts have arrived since the last summary. Set `summarize` to `false` or raise `intervalMinutes` to reduce usage.
- **Sensitive data.** The summary prompt instructs the model to omit secrets, credentials, personal data and source code, and the reply is scrubbed of token-, private-key- and email-shaped strings before it is saved. Only files inside the project appear in the activity log. Review memory files before committing them, and consider adding `.claude/memory/sessions/` to `.gitignore` for private projects.

## Troubleshooting

| Symptom | Resolution |
|---|---|
| Pane shows "No .claude/memory folder" | Run `/memory-init` in the project. |
| Pane does not appear on startup | The terminal is narrower than 144 columns. Run `/memory`, or widen the terminal. |
| `/memory` command not found | Check `claude plugin list` shows memory-keeper as enabled, then run `/reload-plugins`. Requires Claude Code 2.1.290+. |
| Summary never appears | Ensure `summarize` is `true` and at least one prompt has been sent, or run `/memory-sync`. |
| A hook error appears in the transcript | Start Claude Code with `claude --debug` and look for lines prefixed `memory-keeper:`. Please open an issue with the output. |

## Development

```bash
git clone https://github.com/ayushabrol13/memory-keeper.git
cd memory-keeper

claude plugin validate .          # check manifest and hooks module
claude plugin test .              # run the test suite
claude --plugin-dir .             # run Claude Code with the working copy loaded
```

Once Claude Code has loaded the plugin it writes the API typings into `.claude-plugin/types/`, after which `tsc -p .` type-checks the source.

## Project structure

```
memory-keeper/
├── .claude-plugin/
│   ├── plugin.json           # manifest and user options
│   └── marketplace.json      # makes this repository installable as a marketplace
├── hooks/
│   ├── hooks.json            # points Claude Code at the hooks module
│   ├── register.tsx          # plugin implementation
│   └── register.test.ts      # tests
├── types/
│   └── index.d.ts            # session state contract
├── CHANGELOG.md
├── LICENSE
└── README.md
```

## Contributing

Issues and pull requests are welcome.

1. Fork the repository and create a feature branch.
2. Make your change, adding tests where practical.
3. Ensure `claude plugin validate .` and `claude plugin test .` pass.
4. Update `CHANGELOG.md` and open a pull request describing the change.

## License

Released under the [MIT License](LICENSE). © 2026 Ayush Abrol.
