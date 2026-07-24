import { createLogger, DurableObjectRpc, type RateLimiterRpc } from '@typist/core'

const logger = createLogger('mcp-rate-limit')

/**
 * Client for the main worker's RateLimiterDO (bound cross-script). One DO
 * instance per key — keys are namespaced `mcp:{tool}:{userId}:{grantId}` so
 * they can never collide with the main app's auth limiter keys.
 *
 * Fail-open: an unreachable limiter (after DurableObjectRpc's transient
 * retries) must not break tool calls; it only stops damping abuse until the
 * DO recovers.
 */
export class GrantRateLimiter {
  constructor(
    private readonly namespace: DurableObjectNamespace,
    private readonly rpc = new DurableObjectRpc(),
  ) {}

  async check(
    key: string,
    maxRequests: number,
    windowMs: number,
  ): Promise<{ allowed: boolean; retryAfter: number | null }> {
    try {
      // DO stubs cannot be generically typed against a plain interface (the Rpc
      // brand requires the implementation class) — cast to the shared contract.
      const stub = this.namespace.get(
        this.namespace.idFromName(key),
      ) as DurableObjectStub & RateLimiterRpc
      const { allowed, retryAfter } = await this.rpc.call(async () =>
        stub.checkRateLimit(key, maxRequests, windowMs),
      )
      return { allowed, retryAfter }
    } catch (error) {
      logger.warn('mcp_rate_limit_unreachable', { key, error })
      return { allowed: true, retryAfter: null }
    }
  }
}
