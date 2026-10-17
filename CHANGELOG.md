# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.2.3] - 2026-10-17

### Security
- Bounded the secret-assignment redaction pattern and capped summaries at 8,000 characters to rule out catastrophic regex backtracking.

## [0.2.2] - 2026-10-17

### Security
- Writes are anchored to the project root: a symlinked `.claude/` or `.claude/memory/` folder is now refused, not only symlinked files.
- Summary redaction covers more formats: JWTs, GitLab, npm, Stripe, Google and AWS session keys, Slack tokens, credentials in URLs, `key = value` style secret assignments, and PEM keys missing their END marker.

## [0.2.1] - 2026-10-17

### Security
- Writes now resolve symbolic links and are refused unless the target lies inside `.claude/` (or `.claude/memory/` for syncs), and never through a symlinked file.
- Model-written summaries are scrubbed of token-, private-key- and email-shaped strings before being saved.
- The activity log no longer records edited files outside the project.

## [0.2.0] - 2026-10-17

### Added
- `/memory-init` command that creates the standard `.claude/` memory layout without overwriting existing files.
- MIT license, changelog and full documentation.

## [0.1.0] - 2026-10-17

### Added
- Live **Memory** pane (`/memory`) with a colour-coded tree, file sizes and ages, session activity, and Sync / Refresh buttons.
- Timed sync (`intervalMinutes`), sync at session end, and on-demand `/memory-sync`.
- Model-written session summary and activity counts in marker-delimited blocks of the session file.
- Automatic `MEMORY.md` index rebuild that preserves hand-written descriptions.
