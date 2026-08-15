import {
  KVClient,
  WorkersBurstLimiter,
  type BurstLimiter,
  type McpGatewayContract,
  type PostHogAnalyticsService,
} from '@typist/core'

import { createAnalyticsService } from './analytics/create-analytics-service'
import { OAuthStateReplayStore } from './auth/oauth-state-replay-store'
import { McpGatewayClient } from './clients/mcp-gateway-client'

export interface McpServerExecutionContext {
  waitUntil(promise: Promise<unknown>): void
}

export interface McpServerDeps {
  env: McpEnv
  executionCtx: McpServerExecutionContext
  stores: {
    oauthStateReplay: OAuthStateReplayStore
  }
  clients: {
    gateway: McpGatewayClient
  }
  services: {
    analytics: PostHogAnalyticsService
  }
  burst: BurstLimiter
}

/** Composition root shared by the OAuth Worker and the MCP Durable Object. */
export function createMcpServerDeps(
  env: McpEnv,
  executionCtx: McpServerExecutionContext,
): McpServerDeps {
  const gateway = env.TYPIST_GATEWAY as typeof env.TYPIST_GATEWAY & McpGatewayContract
  const oauthKv = new KVClient(env.OAUTH_KV)

  return {
    env,
    executionCtx,
    stores: {
      oauthStateReplay: new OAuthStateReplayStore(oauthKv),
    },
    clients: {
      gateway: new McpGatewayClient(gateway),
    },
    services: {
      analytics: createAnalyticsService(env, executionCtx),
    },
    burst: new WorkersBurstLimiter(env.MCP_BURST_60_PER_MIN),
  }
}
