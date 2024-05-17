import { R2Bucket } from '@cloudflare/workers-types'

export { R2Bucket }

export interface Environment {
  BUCKET: R2Bucket
}

export declare function handler (request: Request, env: Environment): Promise<Response>
