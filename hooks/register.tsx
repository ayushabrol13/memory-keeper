import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, PluginOptions, Register } from 'claude-code'

import type { Activity, MemoryFolder, Snapshot, SyncInfo } from '../types'

const PANE = 'memory-keeper'
const FOLDERS = ['sessions', 'decisions', 'context', 'references']
const ICONS: Record<string, string> = { sessions: '◷', decisions: '◆', context: '◉', references: '↗' }
const COLORS: Record<string, Color> = {
  sessions: 'suggestion',
  decisions: 'claude',
  context: 'success',
  references: 'remember',
}
const SUMMARY_PROMPT = [
  'Summarize this Claude Code session for the project memory file.',
  'Output only Markdown with three sections: "### Done", "### Decisions" (each with a short why), "### Open threads".',
  'At most 15 bullets in total; skip a section with nothing in it. Use absolute dates.',
  'Never include secrets, tokens, credentials, personal data (names, emails, phone numbers) or source code.',
].join(' ')

const snapshot = atom({ plugin: 'memory-keeper', key: 'snapshot' } as const, null)
const activity = atom({ plugin: 'memory-keeper', key: 'activity' } as const, {
  tools: 0,
  bash: 0,
  edited: [],
})
const lastSync = atom({ plugin: 'memory-keeper', key: 'lastSync' } as const, null)
const isSyncing = atom({ plugin: 'memory-keeper', key: 'isSyncing' } as const, false)

const pad = (n: number) => String(n).padStart(2, '0')
const localDate = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const localTime = (ms: number) => {
  const d = new Date(ms)
  return `${localDate(ms)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const ago = (now: number, then: number) => {
  const s = Math.max(0, Math.round((now - then) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
const kb = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`)
const title = (name: string) => name.charAt(0).toUpperCase() + name.slice(1)

// Replaces the text between `<!-- auto:<name>:start -->` and its end marker, or appends the block.
export const replaceBlock = (text: string, name: string, body: string) => {
  const start = `<!-- auto:${name}:start -->`
  const end = `<!-- auto:${name}:end -->`
  const block = `${start}\n${body.trim()}\n${end}`
  const i = text.indexOf(start)
  const j = text.indexOf(end)

  return i >= 0 && j > i
    ? text.slice(0, i) + block + text.slice(j + end.length)
    : `${text.trimEnd()}\n\n${block}\n`
}

const REDACTIONS: [RegExp, string][] = [
  // A PEM private key up to its END marker, or to the end of the text when the marker is missing.
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[redacted-key]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted-jwt]'],
  [
    new RegExp(
      '\\b(' +
        [
          'gh[pousr]_[A-Za-z0-9]{20,}',
          'github_pat_[A-Za-z0-9_]{20,}',
          'glpat-[A-Za-z0-9_-]{20,}',
          'npm_[A-Za-z0-9]{36}',
          'sk-[A-Za-z0-9_-]{20,}',
          '[sr]k_(?:live|test)_[A-Za-z0-9]{16,}',
          'xox[a-z]-[A-Za-z0-9-]{10,}',
          'AIza[A-Za-z0-9_-]{35}',
          '(?:AKIA|ASIA)[0-9A-Z]{16}',
        ].join('|') +
        ')',
      'g',
    ),
    '[redacted-token]',
  ],
  // Credentials in URLs (scheme://user:pass@host) and key = value style assignments.
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, '$1[redacted-credentials]@'],
  [
    /\b([A-Za-z0-9_-]*(?:secret|token|passw(?:or)?d|api[_-]?key|access[_-]?key|private[_-]?key)[A-Za-z0-9_-]*)(\s*[:=]\s*)(["']?)[^\s"'`,;]{6,}\3/gi,
    '$1$2[redacted]',
  ],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[redacted-email]'],
]

// Scrubs credential-, key- and email-shaped strings from model output before it is written to disk.
export const redact = (text: string) => REDACTIONS.reduce((out, [re, to]) => out.replace(re, to), text)

// Where a path lands: the nearest existing ancestor's real path (symlinks resolved) plus the rest.
const placed = async ($: EngineInterface, path: string) => {
  let head = path
  let rest = ''
  for (;;) {
    const stat = await $.fs.stat(head, { resolve: true }).catch(() => undefined)
    if (stat?.realPath) return stat.realPath.replace(/\/$/, '') + rest
    const cut = head.lastIndexOf('/')
    if (cut <= 0) return undefined
    rest = head.slice(cut) + rest
    head = head.slice(0, cut)
  }
}

// Writes only when the path resolves inside `root`, so a symlink can't redirect a write elsewhere.
// The project root is the trust anchor: `root` must resolve to exactly its spelled place under it,
// so a symlinked `.claude` or `memory` folder is refused too.
const safeWrite = async ($: EngineInterface, root: string, path: string, text: string) => {
  const project = await $.session.root()
  const realProject = await placed($, project)
  const realRoot = await placed($, root)
  const real = await placed($, path)
  const isAnchored =
    realProject !== undefined && root.startsWith(`${project}/`) && realRoot === realProject + root.slice(project.length)
  if (!isAnchored || !real?.startsWith(`${realRoot}/`)) {
    throw new Error(`memory-keeper: refused to write ${path}: it resolves outside ${root}`)
  }

  const cut = real.lastIndexOf('/')
  const entries = await $.fs.list(real.slice(0, cut)).catch(() => [])
  if (entries.some(f => f.name === real.slice(cut + 1) && f.isLink)) {
    throw new Error(`memory-keeper: refused to write ${path}: it is a symbolic link`)
  }

  await $.fs.write(real, text)
}

const readText = ($: EngineInterface, path: string) =>
  $.fs.read(path).then(
    text => (typeof text === 'string' ? text : ''),
    () => '',
  )

const scan = async ($: EngineInterface): Promise<Snapshot | null> => {
  const root = `${await $.session.root()}/.claude/memory`
  if (!(await $.fs.exists(root))) {
    await update($, snapshot, () => null)
    return null
  }

  const folders: MemoryFolder[] = []
  for (const name of FOLDERS) {
    const entries = await $.fs.list(`${root}/${name}`).catch(() => [])
    const files = entries
      .filter(f => f.kind === 'file' && f.name.endsWith('.md'))
      .map(({ name, size, mtimeMs }) => ({ name, size, mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
    folders.push({ name, files })
  }

  const snap: Snapshot = { root, folders, scannedAt: await $.clock.now() }
  await update($, snapshot, () => snap)
  return snap
}

// The session's file is the one carrying `<!-- session:<id> -->`; a new one is named by date and id.
const sessionFile = async ($: EngineInterface, root: string, id: string, now: number) => {
  const marker = `<!-- session:${id} -->`
  const dir = `${root}/sessions`
  for (const f of await $.fs.list(dir).catch(() => [])) {
    if (f.kind !== 'file' || !f.name.endsWith('.md')) continue
    const text = await readText($, `${dir}/${f.name}`)
    if (text.includes(marker)) return { path: `${dir}/${f.name}`, text }
  }

  const date = localDate(now)
  return {
    path: `${dir}/${date}-${id.slice(0, 8)}.md`,
    text: `# Session: ${id.slice(0, 8)} — ${date}\n\n${marker}\n`,
  }
}

const activityBlock = (act: Activity, turns: number, now: number, projectRoot: string) => {
  const rel = (p: string) => (p.startsWith(`${projectRoot}/`) ? p.slice(projectRoot.length + 1) : p)
  const files = act.edited
    .filter(p => p.startsWith(`${projectRoot}/`))
    .slice(-20)
    .map(p => `- \`${rel(p)}\``)

  return [
    '## Auto activity',
    '',
    `_Last synced ${localTime(now)} · ${turns} user turns · ${act.tools} tool calls · ${act.bash} shell commands_`,
    '',
    files.length > 0 ? `Files edited this session:\n${files.join('\n')}` : 'No files edited yet.',
  ].join('\n')
}

// Rebuilds MEMORY.md from the folders, keeping each existing entry's hand-written description.
const rebuildIndex = async ($: EngineInterface, snap: Snapshot) => {
  const path = `${snap.root}/MEMORY.md`
  const old = await readText($, path)
  const known = new Map<string, string>()
  for (const m of old.matchAll(/^- \[[^\]]+\]\(([^)]+)\).*$/gm)) if (m[1]) known.set(m[1], m[0])

  const sections = await Promise.all(
    snap.folders.map(async folder => {
      const names = folder.files.map(f => f.name).sort()
      const lines = await Promise.all(
        names.map(async name => {
          const rel = `${folder.name}/${name}`
          const existing = known.get(rel)
          if (existing) return existing
          const heading = (await readText($, `${snap.root}/${rel}`)).match(/^#\s+(.+)$/m)?.[1]
          return `- [${heading ?? name.replace(/\.md$/, '')}](${rel})`
        }),
      )
      return [`## ${title(folder.name)}`, ...lines].join('\n')
    }),
  )

  const next = `# Memory index\n\n${sections.join('\n\n')}\n`
  if (next !== old) await safeWrite($, snap.root, path, next)
}

// Module state starts over on a reload; the next sync then summarizes again.
let summarizedAtTurn = -1

const sync = async ($: EngineInterface, opts: PluginOptions, isForced: boolean) => {
  if (await read($, isSyncing)) return 'memory-keeper: a sync is already running.'
  await update($, isSyncing, () => true)

  try {
    const snap = await scan($)
    if (!snap) return 'memory-keeper: no .claude/memory folder in this project.'

    const now = await $.clock.now()
    const projectRoot = await $.session.root()
    const file = await sessionFile($, snap.root, await $.session.id(), now)
    const turns = await $.session.turns()
    let text = file.text
    let summary = (await read($, lastSync))?.summary ?? ''

    const wantsSummary = isForced || (opts.summarize !== false && turns !== summarizedAtTurn)
    if (wantsSummary && turns > 0) {
      const reply = await $.model.fork({ prompt: SUMMARY_PROMPT })
      if (reply.isAnswered) {
        summary = redact(reply.text.trim())
        summarizedAtTurn = turns
        text = replaceBlock(text, 'summary', `## Auto summary\n\n${summary}`)
      }
    }

    text = replaceBlock(text, 'activity', activityBlock(await read($, activity), turns, now, projectRoot))
    await safeWrite($, snap.root, file.path, text)
    await rebuildIndex($, (await scan($)) ?? snap)
    await scan($)

    const info: SyncInfo = { at: now, sessionFile: file.path.slice(snap.root.length + 1), summary }
    await update($, lastSync, () => info)
    return `memory-keeper: synced ${info.sessionFile} and MEMORY.md.`
  } finally {
    await update($, isSyncing, () => false)
  }
}

const CLAUDE_MD = `# Project memory

Claude Code loads this file automatically at session start. Keep it short; detail lives in \`memory/\`.

@memory/MEMORY.md

## How memory is organized

| Folder | Holds | One file per |
|---|---|---|
| \`memory/sessions/\` | What happened in a session: actions, outcomes, open threads | session (\`YYYY-MM-DD-<name>.md\`) |
| \`memory/decisions/\` | Choices made and why, so they aren't re-litigated | decision (\`NNNN-<slug>.md\`) |
| \`memory/context/\` | Current state of the environment: tools, config, quirks | topic |
| \`memory/references/\` | Pointers to external docs, repos, dashboards | resource |

## Rules for writing memory

- Update an existing file instead of creating a duplicate; delete what turns out wrong.
- Use absolute dates, not "today" or "last week".
- Never store secrets, tokens, personal data or proprietary code.
`

// Creates the standard layout under <project>/.claude, leaving every existing file untouched.
const init = async ($: EngineInterface) => {
  const claudeDir = `${await $.session.root()}/.claude`
  const created: string[] = []
  const files: [string, string][] = [
    ['CLAUDE.md', CLAUDE_MD],
    ['memory/MEMORY.md', `# Memory index\n\n${FOLDERS.map(f => `## ${title(f)}`).join('\n\n')}\n`],
    ...FOLDERS.map((f): [string, string] => [`memory/${f}/.gitkeep`, '']),
  ]

  for (const [rel, text] of files) {
    if (await $.fs.exists(`${claudeDir}/${rel}`)) continue
    await safeWrite($, claudeDir, `${claudeDir}/${rel}`, text)
    created.push(rel)
  }
  await scan($)

  if (created.length === 0) return 'memory-keeper: .claude/memory already set up; nothing changed.'
  const note = created.includes('CLAUDE.md')
    ? ''
    : ' .claude/CLAUDE.md already existed: add the line `@memory/MEMORY.md` to it so sessions load the index.'
  return `memory-keeper: created ${created.filter(r => !r.endsWith('.gitkeep')).join(', ') || 'folders'} in .claude/.${note}`
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'memory-init',
      description: 'Create the .claude/memory folder structure in this project',
    })
    await $.command.register({
      name: 'memory',
      description: 'Show the project .claude/memory folder in a live pane',
    })
    await $.command.register({
      name: 'memory-sync',
      description: 'Sync .claude/memory now: session summary, activity and index',
    })
    await scan($)

    const minutes = Math.max(1, Number(options.intervalMinutes) || 10)
    $.clock.every(60_000, () => void scan($))
    $.clock.every(minutes * 60_000, () => void sync($, options, false))
    void $.ui.open({ id: PANE, title: 'Memory' })

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await sync($, { ...options, summarize: false }, false).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'memory' }, async $ => {
    await scan($)
    const opened = await $.ui.open({ id: PANE, title: 'Memory' })
    return { text: opened.isPlaced ? 'Memory pane opened.' : 'Memory pane is waiting for a wider terminal.' }
  })

  on('command.run', { command: 'memory-sync' }, async $ => ({ text: await sync($, options, true) }))

  on('command.run', { command: 'memory-init' }, async $ => ({ text: await init($) }))

  on('tool.call', async ($, e, next) => {
    const path =
      e.tool === 'Edit' || e.tool === 'Write'
        ? e.file_path
        : e.tool === 'NotebookEdit'
          ? e.notebook_path
          : undefined
    await update($, activity, a => ({
      tools: a.tools + 1,
      bash: a.bash + (e.tool === 'Bash' ? 1 : 0),
      edited: path && !a.edited.includes(path) ? [...a.edited, path].slice(-50) : a.edited,
    }))

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const snap = await read($, snapshot)
    const act = await read($, activity)
    const last = await read($, lastSync)
    const isBusy = await read($, isSyncing)
    const now = await $.clock.now()

    if (!snap) {
      return (
        <Box flexDirection="column" paddingX={1}>
          <Text color="warning">No .claude/memory folder in this project.</Text>
          <Text dimColor>Run /memory-init to create one.</Text>
        </Box>
      )
    }

    const total = snap.folders.reduce((n, f) => n + f.files.length, 0)

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
          <Text bold color="claude">
            Project memory
          </Text>
          <Text dimColor>
            {total} files · {last ? `synced ${ago(now, last.at)}` : 'not synced yet'}
            {isBusy ? ' · syncing…' : ''}
          </Text>
        </Box>

        {snap.folders.map(folder => (
          <Box key={folder.name} flexDirection="column" marginTop={1}>
            <Box>
              <Text bold color={COLORS[folder.name]}>
                {ICONS[folder.name]} {folder.name}/
              </Text>
              <Text dimColor> {folder.files.length}</Text>
            </Box>
            {folder.files.length === 0 && <Text dimColor>  └─ empty</Text>}
            {folder.files.map((f, i) => (
              <Box key={`${folder.name}/${f.name}`}>
                <Text dimColor>{i === folder.files.length - 1 ? '  └─ ' : '  ├─ '}</Text>
                <Text
                  wrap="truncate-end"
                  bold={now - f.mtimeMs < 10 * 60_000}
                  color={now - f.mtimeMs < 10 * 60_000 ? 'success' : 'text'}
                >
                  {f.name}
                </Text>
                <Text dimColor>
                  {'  '}
                  {kb(f.size)} · {ago(now, f.mtimeMs)}
                </Text>
              </Box>
            ))}
          </Box>
        ))}

        <Box flexDirection="column" marginTop={1} borderStyle="single" borderDimColor paddingX={1}>
          <Text bold>This session</Text>
          <Text>
            <Text color="suggestion">{act.tools}</Text> tool calls ·{' '}
            <Text color="suggestion">{act.bash}</Text> shell ·{' '}
            <Text color="suggestion">{act.edited.length}</Text> files edited
          </Text>
          {last && <Text dimColor>Last sync wrote {last.sessionFile}</Text>}
        </Box>

        <Box marginTop={1} gap={1}>
          <Button
            key="sync"
            label={isBusy ? 'Syncing…' : 'Sync now'}
            onPress={() => void sync($, options, true)}
          />
          <Button key="refresh" label="Refresh" onPress={() => void scan($)} />
        </Box>
      </Box>
    )
  })
}
