/**
 * MCP (Model Context Protocol) Support
 *
 * MCP allows AI models to interact with external tools and services.
 * This implementation provides a flexible way to add capabilities to the AI team.
 */

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
  handler: (params: Record<string, unknown>) => Promise<MCPToolResult>;
}

export interface MCPToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface MCPServer {
  name: string;
  description: string;
  tools: MCPTool[];
  connect: () => Promise<boolean>;
  disconnect: () => Promise<void>;
}

// Registry of available MCP servers
const mcpServers: Map<string, MCPServer> = new Map();

// Registry of available tools
const mcpTools: Map<string, MCPTool> = new Map();

/**
 * Register an MCP server
 */
export function registerMCPServer(server: MCPServer): void {
  mcpServers.set(server.name, server);
  // Register all tools from this server
  for (const tool of server.tools) {
    mcpTools.set(`${server.name}:${tool.name}`, tool);
  }
}

/**
 * Get all registered tools
 */
export function getAvailableTools(): MCPTool[] {
  return Array.from(mcpTools.values());
}

/**
 * Execute a tool by name
 */
export async function executeTool(
  toolName: string,
  params: Record<string, unknown>
): Promise<MCPToolResult> {
  const tool = mcpTools.get(toolName);
  if (!tool) {
    return { success: false, error: `Tool "${toolName}" not found` };
  }

  try {
    return await tool.handler(params);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Generate tool descriptions for AI models
 */
export function getToolDescriptions(): string {
  const tools = getAvailableTools();
  if (tools.length === 0) return 'No tools available.';

  return tools
    .map((tool) => {
      const params = Object.entries(tool.inputSchema.properties)
        .map(([name, schema]) => `  - ${name}: ${schema.description}`)
        .join('\n');
      return `**${tool.name}**: ${tool.description}\nParameters:\n${params}`;
    })
    .join('\n\n');
}

// ============================================
// Built-in MCP Tools
// ============================================

/**
 * Web Search Tool
 */
const webSearchTool: MCPTool = {
  name: 'web_search',
  description: 'Search the web for information',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      maxResults: { type: 'number', description: 'Maximum number of results (default: 5)' },
    },
    required: ['query'],
  },
  handler: async (params) => {
    // Placeholder - integrate with actual search API
    const query = params.query as string;
    return {
      success: true,
      data: {
        query,
        results: [
          { title: 'Search result placeholder', url: 'https://example.com', snippet: 'Implement actual search...' }
        ],
        message: 'Web search requires API integration (Tavily, Brave, etc.)',
      },
    };
  },
};

/**
 * File System Tool
 */
const fileSystemTool: MCPTool = {
  name: 'file_system',
  description: 'Read and write files in the project',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Action: read, write, list, delete' },
      path: { type: 'string', description: 'File or directory path' },
      content: { type: 'string', description: 'Content to write (for write action)' },
    },
    required: ['action', 'path'],
  },
  handler: async (params) => {
    const action = params.action as string;
    const path = params.path as string;

    // Security: only allow operations in project directory
    if (path.includes('..') || path.startsWith('/')) {
      return { success: false, error: 'Path traversal not allowed' };
    }

    return {
      success: true,
      data: {
        action,
        path,
        message: 'File system operations require server-side implementation',
      },
    };
  },
};

/**
 * GitHub Tool
 */
const githubTool: MCPTool = {
  name: 'github',
  description: 'Interact with GitHub repositories',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Action: get_repo, list_issues, create_pr, get_file' },
      owner: { type: 'string', description: 'Repository owner' },
      repo: { type: 'string', description: 'Repository name' },
      path: { type: 'string', description: 'File path (for get_file)' },
      title: { type: 'string', description: 'PR/Issue title' },
      body: { type: 'string', description: 'PR/Issue body' },
    },
    required: ['action'],
  },
  handler: async (params) => {
    const action = params.action as string;

    return {
      success: true,
      data: {
        action,
        message: 'GitHub integration available through /api/projects',
      },
    };
  },
};

/**
 * Image Generation Tool
 */
const imageGenerationTool: MCPTool = {
  name: 'generate_image',
  description: 'Generate images using DALL-E or other image models',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Image description/prompt' },
      size: { type: 'string', description: 'Image size: 1024x1024, 1792x1024, 1024x1792' },
      style: { type: 'string', description: 'Style: vivid or natural' },
    },
    required: ['prompt'],
  },
  handler: async (params) => {
    const prompt = params.prompt as string;
    const size = (params.size as string) || '1024x1024';

    // This would call DALL-E API
    return {
      success: true,
      data: {
        prompt,
        size,
        message: 'Image generation requires DALL-E API integration',
        // When implemented:
        // imageUrl: 'https://...'
      },
    };
  },
};

/**
 * Code Execution Tool
 */
const codeExecutionTool: MCPTool = {
  name: 'execute_code',
  description: 'Execute code in a sandboxed environment',
  inputSchema: {
    type: 'object',
    properties: {
      language: { type: 'string', description: 'Programming language: javascript, python, typescript' },
      code: { type: 'string', description: 'Code to execute' },
      timeout: { type: 'number', description: 'Execution timeout in milliseconds' },
    },
    required: ['language', 'code'],
  },
  handler: async (params) => {
    const language = params.language as string;
    const code = params.code as string;

    // Security: sandboxed execution required
    return {
      success: true,
      data: {
        language,
        codeLength: code.length,
        message: 'Code execution requires sandboxed environment (e.g., Docker, VM)',
      },
    };
  },
};

/**
 * Database Query Tool
 */
const databaseTool: MCPTool = {
  name: 'database',
  description: 'Query databases (when connected)',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Action: query, insert, update, delete' },
      table: { type: 'string', description: 'Table name' },
      query: { type: 'string', description: 'SQL query (for raw queries)' },
      data: { type: 'string', description: 'JSON data for insert/update' },
    },
    required: ['action'],
  },
  handler: async (params) => {
    return {
      success: true,
      data: {
        message: 'Database tool requires connection configuration',
      },
    };
  },
};

// ============================================
// Default MCP Server with built-in tools
// ============================================

const defaultMCPServer: MCPServer = {
  name: 'chimera-builtin',
  description: 'Built-in Chimera tools',
  tools: [
    webSearchTool,
    fileSystemTool,
    githubTool,
    imageGenerationTool,
    codeExecutionTool,
    databaseTool,
  ],
  connect: async () => true,
  disconnect: async () => {},
};

// Register default server on module load
registerMCPServer(defaultMCPServer);

/**
 * Format tools for Claude's tool_use format
 */
export function getClaudeTools(): {
  name: string;
  description: string;
  input_schema: MCPTool['inputSchema'];
}[] {
  return getAvailableTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

/**
 * Parse tool calls from model response
 */
export function parseToolCalls(
  response: string
): { toolName: string; params: Record<string, unknown> }[] {
  const toolCalls: { toolName: string; params: Record<string, unknown> }[] = [];

  // Look for tool call patterns in the response
  // Format: <tool_use name="tool_name">{"param": "value"}</tool_use>
  const toolPattern = /<tool_use name="(\w+)">([\s\S]*?)<\/tool_use>/g;
  let match;

  while ((match = toolPattern.exec(response)) !== null) {
    try {
      const toolName = match[1];
      const params = JSON.parse(match[2]);
      toolCalls.push({ toolName, params });
    } catch {
      // Invalid JSON, skip
    }
  }

  return toolCalls;
}

/**
 * Execute tool calls and format results
 */
export async function executeToolCalls(
  toolCalls: { toolName: string; params: Record<string, unknown> }[]
): Promise<{ toolName: string; result: MCPToolResult }[]> {
  const results: { toolName: string; result: MCPToolResult }[] = [];

  for (const call of toolCalls) {
    const result = await executeTool(call.toolName, call.params);
    results.push({ toolName: call.toolName, result });
  }

  return results;
}
