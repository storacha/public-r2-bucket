import { Miniflare } from 'miniflare'
import { equals } from 'uint8arrays'
import { Buffer } from 'buffer'
import * as ByteRanges from 'byteranges'

const mf = new Miniflare({
  modules: true,
  scriptPath: `${import.meta.dirname}/../dist/worker.mjs`,
  compatibilityDate: '2024-05-15',
  r2Buckets: ['BUCKET']
})

export const test = {
  'should respond 404 when key not found': async (/** @type {import('entail').assert} */ assert) => {
    const res = await mf.dispatchFetch('http://localhost:8787/notfound')
    assert.equal(res.status, 404)
  },

  'should GET a value for a key': async (/** @type {import('entail').assert} */ assert) => {
    const key = 'test' + Date.now()
    const value = new Uint8Array([12, 3])
    const bucket = await mf.getR2Bucket('BUCKET')
    await bucket.put(key, value)

    const res = await mf.dispatchFetch(`http://localhost:8787/${key}`)
    assert.equal(res.status, 200)
    assert.ok(equals(new Uint8Array(await res.arrayBuffer()), value))
  },

  'should HEAD a key': async (/** @type {import('entail').assert} */ assert) => {
    const key = 'test' + Date.now()
    const value = new Uint8Array([1, 3, 8])
    const bucket = await mf.getR2Bucket('BUCKET')
    await bucket.put(key, value)

    const res = await mf.dispatchFetch(`http://localhost:8787/${key}`, { method: 'HEAD' })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('Accept-Ranges'), 'bytes')
    assert.equal(res.headers.get('Content-Length'), String(value.length))
    assert.equal(res.body, null)
  },

  'should GET a byte range of a value for a key': async (/** @type {import('entail').assert} */ assert) => {
    const key = 'test' + Date.now()
    const value = new Uint8Array([1, 1, 3, 8])
    const range = [1, 3]
    const bucket = await mf.getR2Bucket('BUCKET')
    await bucket.put(key, value)

    const res = await mf.dispatchFetch(`http://localhost:8787/${key}`, {
      headers: { Range: `bytes=${range[0]}-${range[1]}` }
    })
    assert.equal(res.status, 206)
    assert.equal(res.headers.get('Content-Range'), `bytes ${range[0]}-${range[1]}/${value.length}`)
    assert.ok(equals(new Uint8Array(await res.arrayBuffer()), value.slice(range[0], range[1] + 1)))
  },

  'should GET a multipart byte range of a value for a key': async (/** @type {import('entail').assert} */ assert) => {
    const key = 'test' + Date.now()
    const value = new Uint8Array([1, 1, 3, 8, 1, 1, 3, 8])
    const ranges = [[1, 3], [6, 7]]
    const bucket = await mf.getR2Bucket('BUCKET')
    await bucket.put(key, value)

    const res = await mf.dispatchFetch(`http://localhost:8787/${key}`, {
      headers: { Range: `bytes=${ranges.map(r => `${r[0]}-${r[1]}`).join(', ')}` }
    })
    assert.equal(res.status, 206)

    const contentType = res.headers.get('Content-Type')
    assert.ok(contentType)

    const boundary = contentType.replace('multipart/byteranges; boundary=', '')
    const body = Buffer.from(await res.arrayBuffer())

    const parts = ByteRanges.parse(body, boundary)
    assert.equal(parts.length, ranges.length)

    for (let i = 0; i < parts.length; i++) {
      assert.ok(equals(parts[i].octets, value.slice(ranges[i][0], ranges[i][1] + 1)))
    }
  }
}
