import type { AgentTool } from "./types";
import { getDefaultAgentTools } from "./tools";

type AnyAgentTool = AgentTool<unknown, unknown>;

export class AgentToolRegistry {
  private readonly tools = new Map<string, AnyAgentTool>();

  constructor(tools: AnyAgentTool[] = []) {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  register(tool: AnyAgentTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): AnyAgentTool | undefined {
    return this.tools.get(name);
  }

  list(): AnyAgentTool[] {
    return [...this.tools.values()];
  }

  names(): string[] {
    return [...this.tools.keys()];
  }
}

export function createToolRegistry(tools: AnyAgentTool[] = []): AgentToolRegistry {
  return new AgentToolRegistry(tools);
}

export function createDefaultToolRegistry(): AgentToolRegistry {
  return new AgentToolRegistry(getDefaultAgentTools());
}
