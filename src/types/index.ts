// Re-export analysis types
export * from './analysis';
export * from './project';

// Model types
export type ModelProvider = 'claude' | 'openai' | 'gemini' | 'qwen' | 'grok' | 'deepseek';

export interface ModelConfig {
  id: string;
  provider: ModelProvider;
  name: string;
  apiModel: string;
  strengths: string[];
  available: boolean;
}

// Message types
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  attachments?: Attachment[];
  clarification?: ClarificationRequest;
  executionPlan?: ExecutionPlan;
  modelResponses?: ModelResponse[];
}

export interface Attachment {
  type: 'image' | 'file';
  name: string;
  url: string;
  mimeType: string;
}

// Clarification types
export interface ClarificationQuestion {
  id: string;
  question: string;
  type: 'reference' | 'scope' | 'technical' | 'priority' | 'context';
  options: ClarificationOption[];
  allowCustom: boolean;
  default?: string;
}

export interface ClarificationOption {
  value: string;
  label: string;
  description?: string;
  recommended?: boolean;
}

export interface ClarificationRequest {
  questions: ClarificationQuestion[];
  context: string;
}

export interface ClarificationResponse {
  questionId: string;
  answer: string;
  isCustom: boolean;
}

// Intent & Ambiguity
export interface ParsedIntent {
  action: 'create' | 'modify' | 'delete' | 'fix' | 'explain' | 'analyze';
  object: string;
  scope?: 'minimal' | 'moderate' | 'full';
  constraints?: string[];
  priorities?: string[];
  confidence: number;
}

export interface Ambiguity {
  type: 'reference' | 'scope' | 'technical' | 'priority' | 'context';
  term: string;
  question: string;
  candidates: string[];
  severity: 'low' | 'medium' | 'high';
}

// Execution types
export type ExecutionMode = 'single' | 'council' | 'swarm' | 'deliberation' | 'debate';

export interface ExecutionPhase {
  id: string;
  mode: ExecutionMode;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  models: ModelProvider[];
  progress: number;
  result?: PhaseResult;
}

export interface ExecutionPlan {
  id: string;
  originalMessage: string; // Original user request - NEVER lose this context
  phases: ExecutionPhase[];
  estimatedModels: number;
  currentPhase: number;
  status: 'planning' | 'awaiting_confirmation' | 'executing' | 'completed' | 'failed';
}

export interface PhaseResult {
  output: string;
  votes?: Record<ModelProvider, string>;
  winner?: string;
  iterations?: number;
}

// Model response
export interface ModelResponse {
  model: ModelProvider;
  modelId: string;
  content: string;
  thinking?: string;
  status: 'pending' | 'generating' | 'completed' | 'error';
  error?: string;
  latency?: number;
}

// Council/Debate/Deliberation
export interface CouncilVote {
  model: ModelProvider;
  vote: string;
  reasoning: string;
  confidence: number;
}

export interface CouncilResult {
  question: string;
  votes: CouncilVote[];
  winner: string;
  consensus: number;
  synthesizedAnswer: string;
}

export interface DebateArgument {
  model: ModelProvider;
  position: 'pro' | 'con';
  argument: string;
  round: number;
}

export interface DebateResult {
  question: string;
  proModel: ModelProvider;
  conModel: ModelProvider;
  judgeModel: ModelProvider;
  arguments: DebateArgument[];
  verdict: string;
  reasoning: string;
}

export interface DeliberationIteration {
  round: number;
  generator: ModelProvider;
  reviewer: ModelProvider;
  code: string;
  review: string;
  issues: string[];
  approved: boolean;
}

export interface DeliberationResult {
  task: string;
  iterations: DeliberationIteration[];
  finalCode: string;
  totalRounds: number;
}

// Store state
export interface OrchestratorState {
  messages: Message[];
  currentPlan: ExecutionPlan | null;
  pendingClarification: ClarificationRequest | null;
  isProcessing: boolean;
  models: ModelConfig[];

  // Actions
  addMessage: (message: Omit<Message, 'id' | 'timestamp'>) => void;
  setCurrentPlan: (plan: ExecutionPlan | null) => void;
  setPendingClarification: (clarification: ClarificationRequest | null) => void;
  setProcessing: (processing: boolean) => void;
  updatePhaseStatus: (phaseId: string, status: ExecutionPhase['status'], progress?: number) => void;
}
