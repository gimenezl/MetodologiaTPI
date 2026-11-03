import test from 'node:test'
import assert from 'node:assert/strict'
import { describeTunnelFailure, safeErrorCode } from './tunel-error-seguro.mjs'

test('redacts arbitrary errors and preserves only fixed error codes', () => {
  assert.equal(safeErrorCode({ code: 'ECONNRESET', message: 'secret' }), 'ECONNRESET')
  assert.equal(safeErrorCode({ cause: { code: 'ETIMEDOUT' } }), 'ETIMEDOUT')
  assert.equal(safeErrorCode({ code: 'EXFILTRATE_SECRET' }), 'UNKNOWN')
  assert.equal(safeErrorCode(new Error('https://secret.example/private')), 'UNKNOWN')
  assert.equal(describeTunnelFailure({ direct: { cause: { code: 'ENOTFOUND' } }, dns: 'resolved', fallback: { code: 'ECONNRESET' } }),
    'direct=ENOTFOUND; dns=resolved; fallback=ECONNRESET')
  assert.equal(describeTunnelFailure({ direct: new Error('secret'), dns: 'https://private', fallback: null }),
    'direct=UNKNOWN; dns=unavailable; fallback=NOT_ATTEMPTED')
})
