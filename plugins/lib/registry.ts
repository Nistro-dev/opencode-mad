import type { AgentPermissions } from "../types/enitities"

// Global map to store permissions by sessionID
const agentPermissions = new Map<string, AgentPermissions>()

export const setAgentPermissions = (sessionID: string, permissions: AgentPermissions): void => {
  agentPermissions.set(sessionID, permissions)
}

export const getAgentPermissions = (sessionID: string): AgentPermissions | undefined => {
  return agentPermissions.get(sessionID)
}

export const deleteAgentPermissions = (sessionID: string): boolean => {
  return agentPermissions.delete(sessionID)
}

export const hasAgentPermissions = (sessionID: string): boolean => {
  return agentPermissions.has(sessionID)
}
