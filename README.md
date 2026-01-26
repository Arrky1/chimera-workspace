# Chimera - Multi-Model AI Orchestrator

A powerful AI development team orchestrator that coordinates multiple AI models to work together like a real development company.

## Key Features

### AI Team Management
Chimera creates a virtual AI development team with specialized roles:

| Name | Role | Model | Specialty |
|------|------|-------|-----------|
| Alex | Lead Architect | Claude Opus 4.5 | Architecture, Planning, Team Management |
| Max | Senior Developer | GPT-5.2 | Code, Algorithms, Mathematics |
| Kate | Senior Developer | Claude Sonnet | Code, Refactoring, Best Practices |
| Ivan | Research Engineer | DeepSeek R1 | Deep Reasoning, Research, Analysis |
| Olga | Research Engineer | Qwen3-Max | Research, Synthesis, Tool Use |
| Dasha | Junior Developer | Claude Sonnet | Fast Code, Utilities, Scripts |
| Tim | Junior Developer | o4-mini | Fast Code, Automation |
| Lena | QA Engineer | Gemini Pro | Testing, Multimodal, Validation |
| Elena | Technical Writer | Claude Sonnet | Documentation, API Docs |
| Anna | Security Specialist | GPT-5.2-Pro | Security Audits, Vulnerabilities |

### Orchestration Modes

**Council Mode** - Multiple models vote on architectural decisions
- Each model provides a recommendation with reasoning
- Votes are weighted by confidence
- Alex synthesizes the final decision

**Deliberation Mode** - Generator + Reviewer iterative improvement
- One model generates code
- Another model reviews and suggests improvements
- Process repeats until approval

**Debate Mode** - Pro vs Con arguments with Judge
- Two models argue opposing positions
- A third model judges the debate
- Produces well-reasoned decisions

**Swarm Mode** - Parallel task execution
- Alex breaks down complex tasks
- Team members work in parallel
- Results are synthesized

### Smart Features

- **Intent Detection** - Automatically understands task type and complexity
- **Ambiguity Detection** - Asks clarifying questions when needed
- **Auto Model Routing** - Selects the best model for each task
- **MCP Integration** - Extensible tool support via Model Context Protocol

## Supported Providers

| Provider | Models | Status |
|----------|--------|--------|
| Anthropic | Claude Opus 4.5, Claude Sonnet 4.5 | Supported |
| OpenAI | GPT-5.2, GPT-5.2-Pro, o3, o4-mini | Supported |
| DeepSeek | DeepSeek R1 | Supported |
| Qwen (Alibaba) | Qwen3-Max-Thinking, Qwen2.5-Coder | Supported |
| Google | Gemini 3 Pro, Gemini 3 Flash | Supported |
| xAI | Grok 4.1, Grok 4.1 Fast | Supported |

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env.local

# Add your API keys to .env.local
# Required:
# ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
#
# Optional:
# DEEPSEEK_API_KEY=...
# QWEN_API_KEY=...
# GOOGLE_AI_API_KEY=...
# XAI_API_KEY=...

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── orchestrate/   # Main orchestration endpoint
│   │   ├── team/          # Team management API
│   │   ├── projects/      # GitHub project analysis
│   │   └── auth/          # Authentication
│   ├── login/             # Login page
│   └── page.tsx           # Main dashboard
├── components/
│   ├── ActivityFeed.tsx   # Live AI activity display
│   ├── OrchestrationGraph.tsx # Visual workflow graph
│   ├── EventLog.tsx       # System event log
│   ├── ProjectsDashboard.tsx # GitHub projects
│   └── ...
├── lib/
│   ├── orchestrator.ts    # Core orchestration logic
│   ├── team.ts            # Team management
│   ├── models.ts          # Model configurations
│   ├── mcp.ts             # MCP tool support
│   ├── github.ts          # GitHub integration
│   └── analysis/          # Code analysis
└── types/                 # TypeScript types
```

## MCP (Model Context Protocol) Tools

Built-in tools available to AI models:

- **web_search** - Search the web for information
- **file_system** - Read/write project files
- **github** - GitHub repository operations
- **generate_image** - Image generation (requires DALL-E)
- **execute_code** - Sandboxed code execution
- **database** - Database queries (requires setup)

## API Endpoints

### POST /api/orchestrate
Main orchestration endpoint for processing requests.

```json
{
  "message": "Create a user authentication system",
  "clarificationAnswers": {},  // optional
  "confirmedPlan": null        // optional
}
```

### POST /api/team
Team management operations.

```json
{
  "action": "plan" | "execute" | "status",
  "userRequest": "..."
}
```

### POST /api/projects
GitHub project operations.

```json
{
  "action": "add" | "analyze" | "fix" | "remove",
  "repoUrl": "https://github.com/owner/repo"
}
```

## Deploy to Railway

1. Push to GitHub
2. Connect repo to Railway
3. Add environment variables:
   - `ANTHROPIC_API_KEY`
   - `OPENAI_API_KEY`
   - `APP_PASSWORD` (for login protection)
   - Optional: `DEEPSEEK_API_KEY`, `QWEN_API_KEY`, `GOOGLE_AI_API_KEY`
4. Deploy

## Architecture

```
User Input
    │
    ▼
┌─────────────────────────────────┐
│         Orchestrator            │
│  ├─ Parse Intent                │
│  ├─ Detect Ambiguities          │
│  ├─ Classify Complexity         │
│  └─ Select Execution Mode       │
└──────────────┬──────────────────┘
               │
    ┌──────────┼──────────┐
    │          │          │
    ▼          ▼          ▼
┌────────┐ ┌────────┐ ┌────────┐
│Council │ │Debate  │ │Swarm   │
│ Mode   │ │ Mode   │ │ Mode   │
└────────┘ └────────┘ └────────┘
    │          │          │
    └──────────┼──────────┘
               │
               ▼
┌─────────────────────────────────┐
│      Alex (Lead Architect)      │
│   Synthesizes Final Response    │
└─────────────────────────────────┘
```

## License

MIT
