import { userIdSchema } from '@typist/core'
import { z } from 'zod'

export const mcpTokenPropsSchema = z.object({
  userId: userIdSchema,
})

export type McpTokenProps = z.infer<typeof mcpTokenPropsSchema>
