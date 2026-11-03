// Opt-in: publishes only a disposable synthetic HTTP service through a
// capability-protected tunnel. No production service or credential is used.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { once } from 'node:events'
import { capacidad, crearProxy } from './proxy-tunel-ci.mjs'

test('real tunnel rejects unauthenticated traffic and the local process terminates', { skip: process.env.EPT_TUNNEL_LIVE !== '1', timeout: 180_000 }, async () => {
  assert.ok(process.env.EPT_CLOUDFLARED)
  const seed = randomBytes(32).toString('hex')
  let forwarded = 0
  const target = createServer((req, res) => { forwarded++; res.end('synthetic-only') }).listen(0, '127.0.0.1')
  await once(target, 'listening')
  const proxy = crearProxy({ seed, nombre: 'supabase', targetPort: target.address().port }).listen(0, '127.0.0.1')
  await once(proxy, 'listening')
  // The supervisor remains responsible for stopping cloudflared if this test is interrupted.
  const child = spawn('timeout', ['--signal=TERM', '--kill-after=5s', '160s', process.env.EPT_CLOUDFLARED, 'tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${proxy.address().port}`], { stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  let logs = ''
  let url
  let fetchRetry
  child.stdout.on('data', data => { logs += data.toString() })
  child.stderr.on('data', data => { logs += data.toString() })
  try {
    const until = Date.now() + 60_000
    while (Date.now() < until && !url) {
      url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/u.exec(logs)?.[0]
      if (!url) await new Promise(r => setTimeout(r, 250))
    }
    assert.ok(url, 'The disposable tunnel did not become ready.')
    assert.notEqual(new URL(url).hostname, 'api.trycloudflare.com', 'The log did not contain a generated tunnel hostname.')
    fetchRetry = async (path, retryMs = 30_000) => {
      const end = Date.now() + retryMs
      let code = 'unknown'
      let dnsStatus = 'unavailable'
      while (Date.now() < end) {
        try { return await fetch(`${url}${path}`, { signal: AbortSignal.timeout(3_000) }) } catch (error) {
          const candidate = error?.cause?.code
          if (typeof candidate === 'string' && /^[A-Z_]{1,30}$/u.test(candidate)) code = candidate
          if (candidate === 'ENOTFOUND') {
            // Some Docker environments block wildcard DNS. Resolve through a
            // public DNS-over-HTTPS resolver without logging the tunnel name.
            try {
              const host = new URL(url).hostname
              const dns = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`, {
                headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(3_000),
              })
              const result = await dns.json()
              dnsStatus = `status-${Number(result.Status)}-addresses-${result.Answer?.filter(record => record.type === 1).length ?? 0}`
              const address = result.Answer?.find(record => record.type === 1)?.data
              if (address && /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(address)) {
                return await new Promise((resolve, reject) => {
                  const req = httpsRequest(`${url}${path}`, { lookup: (_host, _opts, callback) => callback(null, address, 4), timeout: 3_000 }, res => {
                    const chunks = []
                    res.on('data', chunk => chunks.push(chunk))
                    res.on('end', () => resolve({ status: res.statusCode, text: async () => Buffer.concat(chunks).toString('utf8') }))
                  })
                  req.on('timeout', () => req.destroy())
                  req.on('error', reject)
                  req.end()
                })
              }
            } catch { /* retry without disclosing hostname */ }
          }
          await new Promise(r => setTimeout(r, 500))
        }
      }
      throw new Error(`The disposable tunnel did not respond (${code}; ${dnsStatus}).`)
    }
    const denied = await fetchRetry('/rest/v1/synthetic')
    assert.equal(denied.status, 403)
    assert.equal(forwarded, 0)
    const authorized = await fetchRetry(`/ci/${capacidad(seed, 'supabase')}/rest/v1/synthetic`)
    assert.equal(authorized.status, 200)
    assert.equal(await authorized.text(), 'synthetic-only')
    assert.equal(forwarded, 1)
  } finally {
    const signalGroup = signal => {
      try { process.kill(-child.pid, signal) } catch (error) { if (error.code !== 'ESRCH') throw error }
    }
    const groupExists = () => {
      try { process.kill(-child.pid, 0); return true } catch (error) {
        if (error.code === 'ESRCH') return false
        throw error
      }
    }
    if (child.exitCode === null && child.signalCode === null) signalGroup('SIGTERM')
    if (child.exitCode === null && child.signalCode === null) await Promise.race([once(child, 'exit'), new Promise(r => setTimeout(r, 5_000))])
    if (groupExists()) signalGroup('SIGKILL')
    const deadline = Date.now() + 5_000
    while (groupExists() && Date.now() < deadline) await new Promise(r => setTimeout(r, 100))
    const groupClosed = !groupExists()
    let stillAvailable = false
    if (url) {
      try {
        const response = await fetchRetry(`/ci/${capacidad(seed, 'supabase')}/rest/v1/synthetic`, 5_000)
        stillAvailable = response.status === 200
      } catch { /* inaccessible after shutdown */ }
    }
    await Promise.all([new Promise(r => proxy.close(r)), new Promise(r => target.close(r))])
    assert.equal(groupClosed, true, 'The disposable tunnel process group did not terminate.')
    // Failure to reach an endpoint cannot prove global closure; process termination is the local evidence.
    assert.equal(stillAvailable, false, 'The disposable tunnel still accepts requests after local shutdown.')
  }
})
