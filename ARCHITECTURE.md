# Chimera - Technical Architecture Document

## Overview

Chimera is a multi-model AI orchestrator that coordinates multiple AI models to work together as a virtual development team. Each AI model is assigned a persona with specific strengths and responsibilities.

## Core Concept

Instead of using a single AI model, Chimera creates a "virtual AI development company" where different models collaborate:
- **Alex (Claude Opus 4.5)** - Lead Architect, manages the team and makes final decisions
- **Max (GPT-5.2)** - Senior Developer, handles complex code and algorithms
- **Kate (Claude Sonnet)** - Senior Developer, code quality and best practices
- **Ivan (DeepSeek R1)** - Research Engineer, deep reasoning and analysis
- **Olga (Qwen3-Max)** - Research Engineer, tool use and synthesis
- **Lena (Gemini Pro)** - QA Engineer, testing and multimodal tasks
- **And more...**

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (Next.js)                       │
│  - Chat Interface                                            │
│  - Projects Dashboard                                        │
│  - Orchestration Monitor (real-time visualization)           │
│  - Settings & API Key Management                             │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                    API Layer (Next.js API Routes)            │
│  /api/orchestrate  - Main orchestration endpoint             │
│  /api/team         - Team management                         │
│  /api/projects     - GitHub project analysis                 │
│  /api/health       - Provider health checks                  │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                    Orchestration Core                        │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Intent Processing                       │    │
│  │  - parseIntent(): Extract action, object, scope      │    │
│  │  - detectAmbiguities(): Find unclear requirements    │    │
│  │  - generateClarificationQuestions(): Ask user        │    │
│  │  - classifyTask(): Determine complexity & mode       │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Execution Modes                         │    │
│  │                                                      │    │
│  │  SINGLE: One model handles the task                  │    │
│  │  COUNCIL: Multiple models vote on decisions          │    │
│  │  DELIBERATION: Generator + Reviewer iteration        │    │
│  │  DEBATE: Pro vs Con arguments with Judge             │    │
│  │  SWARM: Parallel task execution by team              │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Team Management                         │    │
│  │  - TeamManager: Singleton managing AI team           │    │
│  │  - Dynamic member creation based on needs            │    │
│  │  - Task assignment based on role/specialty           │    │
│  │  - Memory cleanup (completed tasks, idle members)    │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                    Model Layer                               │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Provider Clients                        │    │
│  │  - Anthropic (Claude Opus 4.5, Sonnet 4.5)          │    │
│  │  - OpenAI (GPT-5.2, GPT-5.2-Pro, o3, o4-mini)       │    │
│  │  - Google (Gemini 3 Pro, Gemini 3 Flash)            │    │
│  │  - Alibaba (Qwen3-Max-Thinking, Qwen2.5-Coder)      │    │
│  │  - xAI (Grok 4.1, Grok 4.1 Fast)                    │    │
│  │  - DeepSeek (DeepSeek R1)                           │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Reliability Features                    │    │
│  │  - Request timeouts (per-provider configuration)     │    │
│  │  - Health tracking (consecutive failures)            │    │
│  │  - Automatic fallback to healthy providers           │    │
│  │  - Rate limiting for parallel requests               │    │
│  │  - Exponential backoff retry logic                   │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Execution Modes Explained

### 1. Single Mode
Simple tasks handled by one model.
```
User Request → Best Model Selection → Response
```

### 2. Council Mode
Architecture decisions voted on by multiple models.
```
User Request → All Models Vote → Weighted Consensus → Alex Synthesizes
```
Each model provides:
- RECOMMENDATION: Specific suggestion
- REASONING: Why this approach
- CONFIDENCE: HIGH/MEDIUM/LOW

### 3. Deliberation Mode
Iterative code improvement between generator and reviewer.
```
User Request → Generator Creates Code → Reviewer Checks
                      ↑                        ↓
                      └──── If Issues ─────────┘
                             ↓
                      Final Approved Code
```

### 4. Debate Mode
Pro vs Con arguments for difficult decisions.
```
Question → PRO Model Argues → CON Model Counters → Judge Decides
              ↓                    ↓
         Multiple Rounds of Arguments
```

### 5. Swarm Mode
Complex tasks broken into parallel subtasks.
```
User Request → Alex Analyzes → Task Breakdown
                                    ↓
              ┌─────────┬─────────┬─────────┐
              ↓         ↓         ↓         ↓
           Task 1    Task 2    Task 3    Task 4
           (Max)     (Kate)    (Ivan)    (Lena)
              ↓         ↓         ↓         ↓
              └─────────┴─────────┴─────────┘
                          ↓
                Alex Synthesizes Results
```

## Key Files

### `/src/lib/orchestrator.ts`
Core orchestration logic:
- `parseIntent()` - Extracts user intent using Claude
- `detectAmbiguities()` - Identifies unclear requirements
- `classifyTask()` - Determines complexity and best mode
- `createExecutionPlan()` - Creates phased execution plan
- `executeCouncil()` - Runs voting among models
- `executeDeliberation()` - Runs generator/reviewer loop
- `executeDebate()` - Runs pro/con debate with judge
- `executeAdvancedCouncil()` - Weighted voting with synthesis

### `/src/lib/models.ts`
Model management and API calls:
- Provider clients (Anthropic, OpenAI, Google, etc.)
- `generateWithModel()` - Main generation function with timeout
- `generateWithFallback()` - Auto-fallback on failure
- Health tracking (`markProviderSuccess`, `markProviderFailure`)
- User-friendly error messages (`formatErrorMessage`)

### `/src/lib/team.ts`
AI team management:
- `TeamManager` class - Manages virtual team
- `analyzeAndPlanTask()` - Alex plans task breakdown
- `assembleTeam()` - Creates team for specific roles
- `assignTask()` - Assigns task to best member
- `executeTask()` - Member executes assigned task
- Memory cleanup for completed tasks and idle members

### `/src/lib/mcp.ts`
MCP (Model Context Protocol) tools with governance:
- `web_search` - Search the web (low risk)
- `file_system` - Read/write files (high risk, requires approval)
- `github` - GitHub operations (medium risk)
- `generate_image` - Image generation (low risk)
- `execute_code` - Sandboxed code execution (critical, disabled)
- `database` - Database queries (critical, disabled)

Access control features:
- `checkToolAccess()` - Validates tool access based on policies
- `getToolPolicy()` - Returns policy for a specific tool
- Risk levels: low, medium, high, critical
- Rate limiting per tool
- Audit logging for tool access

### `/src/lib/execution-store.ts`
Persistent execution state management:
- Redis storage with in-memory fallback
- `createExecution()` - Initialize new execution
- `getExecution()` / `updateExecution()` - State management
- `startPhase()` / `completePhase()` / `failPhase()` - Phase tracking
- `recordModelCall()` - Log model API calls
- `checkIdempotency()` / `setIdempotency()` - Prevent duplicate execution
- `cancelExecution()` - Cancel running execution
- `getAuditLog()` - Retrieve execution history

### `/src/lib/schemas.ts`
Zod validation schemas for type safety:
- `OrchestrateRequestSchema` - Request validation
- `ExecutionPlanSchema` - Plan structure validation
- `ParsedIntentSchema` - Intent parsing
- `validateOrThrow()` - Strict validation
- `validateWithRepair()` - Validation with fallback defaults
- `parseLLMResponse()` - Extract structured data from LLM output

### `/src/app/api/orchestrate/route.ts`
Main API endpoint:
- POST handler for all orchestration requests
- Clarification flow handling
- Plan execution with rate limiting
- Retry logic with exponential backoff
- Idempotency checking
- Execution state persistence
- Returns `executionId` for tracking

### `/src/app/api/orchestrate/stream/route.ts`
Streaming orchestration endpoint:
- POST: Start streaming execution with SSE events
- DELETE: Cancel running execution via AbortController
- GET: Check execution status
- Real-time phase/model/tool progress events

### `/src/app/api/health/route.ts`
Health monitoring:
- GET: Quick status check
- POST: Deep health check with actual API calls

## Data Flow

### 1. Initial Request
```
User Message
    ↓
parseIntent() → { action, object, scope, confidence }
    ↓
detectAmbiguities() → [{ type, term, question, severity }]
    ↓
If ambiguities → generateClarificationQuestions() → Ask User
    ↓
classifyTask() → { complexity, recommendedMode, estimatedSubtasks }
    ↓
createExecutionPlan() → { phases, estimatedModels }
```

### 2. Plan Execution
```
ExecutionPlan
    ↓
For each phase:
    ↓
    Switch (phase.mode):
        council → executeAdvancedCouncil()
        deliberation → executeDeliberation()
        debate → executeDebate()
        swarm → executeSwarmMode()
        single → executeSingleMode()
    ↓
    Results collected
    ↓
Final Response to User
```

## Reliability Features

### Timeouts
```typescript
PROVIDER_TIMEOUTS = {
  claude: 90000,    // Complex reasoning
  openai: 60000,
  gemini: 45000,    // Fast model
  qwen: 120000,     // Thinking models
  grok: 60000,
  deepseek: 120000, // R1 reasoning
}
```

### Health Tracking
- Tracks consecutive failures per provider
- After 3 failures → provider marked unhealthy
- Auto-recovery after 5 minutes
- Health status exposed via `/api/health`

### Fallback Chain
```
Preferred Provider → Failed?
    ↓ Yes
Claude → OpenAI → DeepSeek → Qwen
```

### Rate Limiting
- Max 3 concurrent requests
- 500ms delay between batches
- Prevents API rate limit errors

### Retry Logic
- Exponential backoff: 1s → 2s → 4s
- Max 3 retries
- Skip retry on 4xx errors (client errors)

## Memory Management

### TeamManager Cleanup
Every 5 minutes:
- Remove completed tasks beyond 100
- Remove idle members beyond 20
- Preserves lead (Alex) always

### Serverless Considerations
- State is lost between requests in serverless
- TeamManager is singleton but ephemeral
- Consider Redis/database for persistent state

## API Endpoints

### POST /api/orchestrate
Main orchestration endpoint.

Request:
```json
{
  "message": "Create a user authentication system",
  "clarificationAnswers": {},  // optional
  "confirmedPlan": null        // optional ExecutionPlan
}
```

Response types:
- `clarification` - Need user input
- `plan` - Execution plan for confirmation
- `result` - Task completed
- `execution_complete` - Multi-phase execution done
- `error` - Something went wrong

### GET /api/health
Quick health check.

Response:
```json
{
  "status": "healthy|degraded",
  "providers": {
    "total": 4,
    "healthy": 3,
    "details": { ... }
  },
  "team": {
    "members": 5,
    "activeTasks": 2
  }
}
```

### POST /api/health
Deep health check (tests each provider).

Request:
```json
{
  "providers": ["claude", "openai"]  // optional
}
```

## Environment Variables

Required:
- `ANTHROPIC_API_KEY` - Claude models
- `OPENAI_API_KEY` - OpenAI models
- `APP_PASSWORD` - Login protection

Recommended:
- `REDIS_URL` - Persistent state storage (e.g., `redis://localhost:6379`)

Optional:
- `DEEPSEEK_API_KEY` - DeepSeek R1
- `QWEN_API_KEY` - Qwen models
- `GOOGLE_AI_API_KEY` - Gemini models
- `XAI_API_KEY` - Grok models

## Reliability Layer

### Execution Store
```
┌─────────────────────────────────────────────────────────────┐
│                    Execution Store                          │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Storage Backend                         │   │
│  │  - Redis (REDIS_URL) - Production recommended       │   │
│  │  - In-Memory - Automatic fallback for dev           │   │
│  │  - TTL: 24 hours for executions, 7 days for audit   │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              State Management                        │   │
│  │  - ExecutionState: pending/running/completed/failed │   │
│  │  - PhaseResults: per-phase tracking                 │   │
│  │  - ModelCallRecords: API call history               │   │
│  │  - Audit logging: all events timestamped            │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Features                                │   │
│  │  - Idempotency keys prevent duplicate execution     │   │
│  │  - Resumable executions after restart               │   │
│  │  - Cancellation via AbortController                 │   │
│  │  - Full audit trail for debugging                   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### MCP Governance
```
┌─────────────────────────────────────────────────────────────┐
│                    Tool Access Control                      │
│                                                             │
│  Risk Levels:                                               │
│  ├─ LOW: web_search, generate_image                        │
│  ├─ MEDIUM: github                                         │
│  ├─ HIGH: file_system (requires approval)                  │
│  └─ CRITICAL: execute_code, database (disabled)            │
│                                                             │
│  Policy Enforcement:                                        │
│  ├─ Pre-execution access check                             │
│  ├─ Rate limiting per tool                                 │
│  ├─ Role-based allow/deny lists                            │
│  ├─ Parameter restrictions                                 │
│  └─ Audit logging for all access attempts                  │
└─────────────────────────────────────────────────────────────┘
```

### Streaming Architecture
```
Client                           Server
  │                                │
  │ POST /api/orchestrate/stream   │
  │──────────────────────────────>│
  │                                │
  │<── SSE: phase:parsing ─────────│
  │<── SSE: phase:ambiguity_check ─│
  │<── SSE: phase:planning ────────│
  │<── SSE: execution_started ─────│
  │<── SSE: model_call_started ────│
  │<── SSE: model_call_completed ──│
  │<── SSE: tool_calls_started ────│
  │<── SSE: tool_calls_completed ──│
  │<── SSE: phase_completed ───────│
  │<── SSE: complete ──────────────│
  │                                │
  │ DELETE ?executionId=xxx        │ (optional: cancel)
  │──────────────────────────────>│
  │<── SSE: cancelled ─────────────│
```

## Known Limitations

1. **Token Limits**: Large contexts may exceed model limits
2. **Cost**: Multiple model calls can be expensive
3. **Redis Required**: Full persistence requires Redis setup

## Implemented (Previously Planned)

✅ **Persistent State**: Redis + in-memory fallback via execution-store.ts
✅ **Streaming**: SSE via /api/orchestrate/stream endpoint
✅ **Cancellation**: AbortController + cancelExecution()
✅ **Validation**: Zod schemas for request/response
✅ **Idempotency**: Duplicate execution prevention
✅ **MCP Governance**: Tool access policies and audit logging

## Future Improvements

1. **Cost Tracking**: Per-request cost estimation
2. **Caching**: Cache common responses
3. **Metrics**: Prometheus/Grafana integration
4. **WebSocket**: Alternative to SSE for bidirectional communication
5. **Distributed Execution**: Multi-node support
