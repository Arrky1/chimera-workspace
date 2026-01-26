# Unified Orchestrator

Multi-model AI orchestrator with Council, Debate, and Deliberation modes.

## Features

- **Smart Clarification**: Detects ambiguous requests and asks clarifying questions
- **Council Mode**: Multiple models vote on architectural decisions
- **Deliberation Mode**: Generator + Reviewer iterative improvement
- **Debate Mode**: Pro vs Con arguments with Judge (coming soon)
- **Swarm Mode**: Parallel agent execution (coming soon)
- **Auto Model Routing**: Automatically selects best model for task

## Supported Models

- **Claude** (Anthropic): Code, Architecture, Complex Reasoning
- **GPT-4** (OpenAI): Math, STEM, General
- **Gemini** (Google): Multimodal, Long Context (optional)
- **Qwen** (Alibaba): Math, Agentic, Tool Use (optional)

## Quick Start

```bash
# Install dependencies
npm install

# Copy env file
cp .env.example .env.local

# Add your API keys to .env.local
# ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Deploy to Railway

1. Push to GitHub
2. Connect repo to Railway
3. Add environment variables:
   - `ANTHROPIC_API_KEY`
   - `OPENAI_API_KEY`
4. Deploy

## Architecture

```
User Input
    │
    ▼
┌─────────────┐
│ Orchestrator│
│  ├─ Parse   │
│  ├─ Detect  │
│  └─ Route   │
└──────┬──────┘
       │
   ┌───┴───┐
   │       │
   ▼       ▼
┌─────┐ ┌─────────┐
│Exec │ │Clarify  │
│     │ │Questions│
└─────┘ └─────────┘
```

## License

MIT
