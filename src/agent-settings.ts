import { z } from 'zod';
import { mcpServiceSchema } from './mcp';

export const agentSettingsSchema = z.object({
  folders: z.array(z.string()).max(100).default([]),
  webSearch: z.boolean().default(false),
  services: z.array(mcpServiceSchema).max(20).default([]),
  consentVersion: z.number().int().nonnegative().default(0),
});
export type AgentSettings = z.infer<typeof agentSettingsSchema>;
export const emptyAgentSettings = (): AgentSettings => ({
  folders: [],
  webSearch: false,
  services: [],
  consentVersion: 1,
});
