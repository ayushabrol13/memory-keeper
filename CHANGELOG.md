# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

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
