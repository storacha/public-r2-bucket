import { R2Bucket } from '@cloudflare/workers-types'
import { Environment as MiddlewareEnvironment } from '@web3-storage/gateway-lib'

export { R2Bucket }

export interface Environment extends MiddlewareEnvironment {
  BUCKET: R2Bucket
  FF_TELEMETRY_ENABLED: string
  HONEYCOMB_API_KEY: string
}

export declare function handler (request: Request, env: Environment): Promise<Response>
