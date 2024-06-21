/* eslint-env worker */
import {
  withContext,
  withCorsHeaders,
  withCdnCache,
  withFixedLengthStream,
  composeMiddleware
} from '@web3-storage/gateway-lib/middleware'
import { createHandler } from '@web3-storage/public-bucket/server'

/**
 * 20MiB should allow the worker to process ~4-5 concurrent requests that
 * require a batch at the maximum size.
 */
const MAX_BATCH_SIZE = 20 * 1024 * 1024

export default {
  /** @type {import('@web3-storage/gateway-lib').Handler<import('@web3-storage/gateway-lib').Context, import('./worker.js').Environment>} */
  fetch (request, env, ctx) {
    console.log(request.method, request.url)
    const bucket = /** @type {import('@web3-storage/public-bucket').Bucket} */ (env.BUCKET)
    const handler = createHandler({ bucket, maxBatchSize: MAX_BATCH_SIZE })
    const middleware = composeMiddleware(
      withCdnCache,
      withContext,
      withCorsHeaders,
      withFixedLengthStream
    )
    return middleware(handler)(request, env, ctx)
  }
}
