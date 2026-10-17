import { expect, test } from 'claude-code/testing'

import { redact, replaceBlock } from './register'

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

test('redacts token-, key- and email-shaped strings from summaries', () => {
  const out = redact(
    'Used ghp_' + 'a'.repeat(36) + ' and AKIA' + 'B'.repeat(16) + ', mailed dev@example.com.\n' +
      '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----',
  )

  expect(out).toBe('Used [redacted-token] and [redacted-token], mailed [redacted-email].\n[redacted-key]')
})

test('leaves ordinary summary text unchanged', () => {
  const text = '### Done\n- 2026-10-17: Added rate limiting to `api/routes.ts`.'

  expect(redact(text)).toBe(text)
})

test('redacts URL credentials, secret assignments, JWTs and unterminated keys', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.c2lnbmF0dXJlMTIz'
  const out = redact(
    `db at postgres://admin:hunter22@db.local/app, API_KEY=abcd1234efgh, token: "zzzz9999", ${jwt}\n` +
      '-----BEGIN PRIVATE KEY-----\nMIIEvQ',
  )

  expect(out).toBe(
    'db at postgres://[redacted-credentials]@db.local/app, API_KEY=[redacted], token: [redacted], [redacted-jwt]\n' +
      '[redacted-key]',
  )
})
