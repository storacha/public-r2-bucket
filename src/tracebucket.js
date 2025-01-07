// eslint-disable-next-line
import * as BucketAPI from '@web3-storage/public-bucket'
import { trace, context, SpanStatusCode } from '@opentelemetry/api'

/**
 * @template {unknown[]} A
 * @template {*} T
 * @template {*} This
 * @param {string} spanName
 * @param {(this: This, ...args: A) => Promise<T>} fn
 * @param {This} [thisParam]
 */
const withSimpleSpan = (spanName, fn, thisParam) =>
  /**
   * @param {A} args
  */
  async (...args) => {
    const tracer = trace.getTracer('public-r2-bucket')
    const span = tracer.startSpan(spanName)
    const ctx = trace.setSpan(context.active(), span)

    try {
      const result = await context.with(ctx, fn, thisParam, ...args)
      span.setStatus({ code: SpanStatusCode.OK })
      span.end()
      return result
    } catch (err) {
      if (err instanceof Error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err.message
        })
      } else {
        span.setStatus({
          code: SpanStatusCode.ERROR
        })
      }
      span.end()
      throw err
    }
  }

/** @implements {BucketAPI.Bucket} */
export class TraceBucket {
  #bucket

  /**
   *
   * @param {BucketAPI.Bucket} bucket
   */
  constructor (bucket) {
    this.#bucket = bucket
  }

  /** @param {string} key */
  head (key) {
    return withSimpleSpan('bucket.head', this.#bucket.head, this.#bucket)(key)
  }

  /**
   * @param {string} key
   * @param {BucketAPI.GetOptions} [options]
   */
  get (key, options) {
    return withSimpleSpan('bucket.get', this.#bucket.get, this.#bucket)(key, options)
  }
}
