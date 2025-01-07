/* eslint-env worker */
import {
  withContext,
  withCorsHeaders,
  withCdnCache,
  withFixedLengthStream,
  composeMiddleware
} from '@web3-storage/gateway-lib/middleware'
import { createHandler } from '@web3-storage/public-bucket/server'
import { instrument } from '@microlabs/otel-cf-workers'
import { AlwaysOffSampler, NoopSpanProcessor, ParentBasedSampler } from '@opentelemetry/sdk-trace-base'
import { TraceBucket } from './tracebucket.js'

/**
 * @import {
 *   Handler,
 *   Middleware,
 *   Context,
 *   IpfsUrlContext,
 *   BlockContext,
 *   DagContext,
 *   UnixfsContext
 * } from '@web3-storage/gateway-lib'
 * @import { Environment } from './worker.d.ts'
 */

/**
 * 20MiB should allow the worker to process ~4-5 concurrent requests that
 * require a batch at the maximum size.
 */
const MAX_BATCH_SIZE = 20 * 1024 * 1024

/**
 * The promise to the pre-configured handler
 *
 * @type {Promise<Handler<Context, Environment>> | null}
 */
let handlerPromise = null

/**
 * Pre-configure the handler based on the environment.
 *
 * @param {Environment} env
 * @returns {Promise<Handler<Context, Environment>>}
 */
async function initializeHandler (env) {
  const bucket = new TraceBucket(/** @type {import('@web3-storage/public-bucket').Bucket} */ (env.BUCKET))
  const handler = createHandler({ bucket, maxBatchSize: MAX_BATCH_SIZE })
  const middleware = composeMiddleware(
    withCdnCache,
    withContext,
    withCorsHeaders,
    withFixedLengthStream
  )
  const baseHandler = middleware(handler)
  if (env.FF_TELEMETRY_ENABLED === 'true') {
    globalThis.fetch = globalThis.fetch.bind(globalThis)
  }
  const finalHandler = env.FF_TELEMETRY_ENABLED === 'true'
    ? /** @type {Handler<Context, Environment>} */(instrument({ fetch: baseHandler }, config).fetch)
    : baseHandler
  return finalHandler
}

/**
 * Configure the OpenTelemetry exporter based on the environment
 *
 * @param {Environment} env
 * @param {*} _trigger
 * @returns {import('@microlabs/otel-cf-workers').TraceConfig}
 */
function config (env, _trigger) {
  if (env.HONEYCOMB_API_KEY) {
    return {
      exporter: {
        url: 'https://api.honeycomb.io/v1/traces',
        headers: { 'x-honeycomb-team': env.HONEYCOMB_API_KEY }
      },
      service: { name: 'freeway' },
      sampling: {
        headSampler: new ParentBasedSampler({ root: new AlwaysOffSampler() })
      }
    }
  }
  return {
    spanProcessors: new NoopSpanProcessor(),
    service: { name: 'freeway' }
  }
}

export default {
  /** @type {import('@web3-storage/gateway-lib').Handler<import('@web3-storage/gateway-lib').Context, import('./worker.js').Environment>} */
  async fetch (request, env, ctx) {
    console.log(request.method, request.url)
    // Initialize the handler only once and reuse the promise
    if (!handlerPromise) {
      handlerPromise = initializeHandler(env)
    }
    const handler = await handlerPromise
    return handler(request, env, ctx)
  }
}
