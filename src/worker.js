/* eslint-env worker */
import {
  withContext,
  withCorsHeaders,
  withErrorHandler,
  createWithHttpMethod,
  withCdnCache,
  withFixedLengthStream,
  composeMiddleware
} from '@web3-storage/gateway-lib/middleware'
import { HttpError, decodeRangeHeader, resolveRange } from '@web3-storage/gateway-lib/util'
import { MultipartByteRange } from 'multipart-byte-range'

/**
 * @typedef {{ BUCKET: import('@cloudflare/workers-types').R2Bucket }} Environment
 */

export default {
  /** @type {import('@web3-storage/gateway-lib').Handler<import('@web3-storage/gateway-lib').Context, Environment>} */
  fetch (request, env, ctx) {
    console.log(request.method, request.url)
    const middleware = composeMiddleware(
      withCdnCache,
      withContext,
      withCorsHeaders,
      withErrorHandler,
      createWithHttpMethod('GET', 'HEAD'),
      withFixedLengthStream
    )
    return middleware(handler)(request, env, ctx)
  }
}

/**
 * @param {Request} request
 * @param {Environment} env
 */
async function handler (request, env) {
  const url = new URL(request.url)
  const key = url.pathname.slice(1)

  const object = await env.BUCKET.head(key)
  if (!object) throw new HttpError('Object Not Found', { status: 404 })

  const headers = new Headers()
  headers.set('Etag', object.httpEtag)

  if (request.method === 'HEAD') {
    headers.set('Accept-Ranges', 'bytes')
    headers.set('Content-Length', object.size.toString())
    return new Response(undefined, { headers })
  }

  /** @type {import('multipart-byte-range').Range[]} */
  let ranges = []
  if (request.headers.has('range')) {
    try {
      ranges = decodeRangeHeader(request.headers.get('range') ?? '')
    } catch (err) {
      throw new HttpError('invalid range', { cause: err, status: 400 })
    }
  }

  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Content-Type', 'application/octet-stream')
  headers.set('Etag', object.httpEtag)
  headers.set('Cache-Control', 'public, max-age=29030400, immutable')
  headers.set('Vary', 'Range')

  if (ranges.length > 1) {
    return handleMultipartRange(env.BUCKET, key, object.size, ranges, { headers })
  } else if (ranges.length === 1) {
    return handleRange(env.BUCKET, key, object.size, ranges[0], { headers })
  }

  // no range is effectively Range: bytes=0-
  return handleRange(env.BUCKET, key, object.size, [0], { headers })
}

/**
 * @param {import('@cloudflare/workers-types').R2Bucket} bucket
 * @param {string} key
 * @param {number} size
 * @param {import('multipart-byte-range').Range} range
 * @param {{ headers?: Headers }} [options]
 */
const handleRange = async (bucket, key, size, range, options) => {
  const [first, last] = resolveRange(range, size)
  const contentLength = last - first + 1

  const headers = new Headers(options?.headers)
  headers.set('Content-Length', String(contentLength))

  if (size !== contentLength) {
    const contentRange = `bytes ${first}-${last}/${size}`
    headers.set('Content-Range', contentRange)
  }

  const status = size === contentLength ? 200 : 206
  const object = await bucket.get(key, { range: { offset: first, length: contentLength } })
  if (!object || !object.body) throw new HttpError('Object Not Found', { status: 404 })

  const source = /** @type {ReadableStream} */ (object.body)
  return new Response(source, { status, headers })
}

/**
 * @param {import('@cloudflare/workers-types').R2Bucket} bucket
 * @param {string} key
 * @param {number} size
 * @param {import('multipart-byte-range').Range[]} ranges
 * @param {{ headers?: Headers }} [options]
 */
const handleMultipartRange = async (bucket, key, size, ranges, options) => {
  const source = new MultipartByteRange(ranges, async range => {
    const options = { range: { offset: range[0], length: range[1] - range[0] + 1 } }
    const object = await bucket.get(key, options)
    if (!object || !object.body) throw new HttpError('Object Not Found', { status: 404 })
    return /** @type {ReadableStream} */ (object.body)
  }, { totalSize: size })

  const headers = new Headers(options?.headers)
  for (const [k, v] of Object.entries(source.headers)) {
    headers.set(k, v)
  }

  return new Response(source, { status: 206, headers })
}
