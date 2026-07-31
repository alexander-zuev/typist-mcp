import { userIdSchema } from '@typist/core'
import { z } from 'zod'

/**
 * Decrypted from the bearer token on every request. The client fields carry the
 * OAuth registration identity into the MCP session, which otherwise only knows
 * the handshake name. Optional: grants issued before they were recorded are
 * still valid and must keep working.
 */
export const mcpTokenPropsSchema = z.object({
  userId: userIdSchema,
  clientId: z.string().optional(),
  clientName: z.string().optional(),
})

export type McpTokenProps = z.infer<typeof mcpTokenPropsSchema>
