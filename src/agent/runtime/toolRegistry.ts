import type { AgentTool } from "./types";
import { getDefaultAgentTools } from "./tools";

export class AgentToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  constructor(tools: AgentTool[] = []) {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  register(tool: AgentTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  list(): AgentTool[] {
    return [...this.tools.values()];
  }

  names(): string[] {
    return [...this.tools.keys()];
  }
}

export function createToolRegistry(tools: AgentTool[] = []): AgentToolRegistry {
  return new AgentToolRegistry(tools);
}

export function createDefaultToolRegistry(): AgentToolRegistry {
  return new AgentToolRegistry(getDefaultAgentTools());
}
