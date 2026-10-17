import { expect, test } from 'claude-code/testing'

import { replaceBlock } from './register'

test('appends an auto block to a file without one', () => {
  const out = replaceBlock('# Session\n\nnotes\n', 'activity', 'counts')

  expect(out).toBe('# Session\n\nnotes\n\n<!-- auto:activity:start -->\ncounts\n<!-- auto:activity:end -->\n')
})

test('replaces only its own block and keeps hand-written text around it', () => {
  const before = 'intro\n<!-- auto:summary:start -->\nold\n<!-- auto:summary:end -->\noutro\n'
  const out = replaceBlock(before, 'summary', 'new')

  expect(out).toBe('intro\n<!-- auto:summary:start -->\nnew\n<!-- auto:summary:end -->\noutro\n')
  expect(replaceBlock(out, 'activity', 'x')).toContain('<!-- auto:summary:start -->\nnew')
})
