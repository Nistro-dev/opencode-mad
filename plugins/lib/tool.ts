import { z } from "zod"
import type { ToolDefinition } from "../types/enitities"

/** Local `tool()` helper so tool definitions stay compact and typed. */
export const tool = Object.assign(
  <Args extends z.ZodRawShape>(definition: ToolDefinition<Args>): ToolDefinition<Args> => definition,
  { schema: z },
)
