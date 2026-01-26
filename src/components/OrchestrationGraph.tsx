'use client';

import { useCallback, useEffect, useState } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Position,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { ModelProvider, ExecutionMode } from '@/types';
import { Brain, Sparkles, Zap, MessageSquare, Users, GitCompare } from 'lucide-react';

// Custom node component
interface ModelNodeData {
  label: string;
  provider: ModelProvider;
  status: 'idle' | 'active' | 'complete' | 'error';
  task?: string;
  progress?: number;
  tokens?: number;
}

const modelColors: Record<ModelProvider, string> = {
  claude: '#f97316',
  openai: '#22c55e',
  gemini: '#3b82f6',
  qwen: '#a855f7',
  grok: '#ef4444',
  deepseek: '#06b6d4',
};

function ModelNode({ data }: { data: ModelNodeData }) {
  const color = modelColors[data.provider] || '#6b7280';
  const isActive = data.status === 'active';

  return (
    <div
      className={`
        relative px-4 py-3 rounded-xl border-2 min-w-[140px]
        transition-all duration-300 backdrop-blur-sm
        ${isActive ? 'shadow-lg scale-105' : 'shadow-md'}
      `}
      style={{
        borderColor: isActive ? color : `${color}50`,
        backgroundColor: `${color}15`,
      }}
    >
      {/* Pulse animation for active nodes */}
      {isActive && (
        <div
          className="absolute inset-0 rounded-xl animate-ping opacity-20"
          style={{ backgroundColor: color }}
        />
      )}

      <div className="relative z-10">
        <div className="flex items-center gap-2 mb-1">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: color }}
          />
          <span className="text-sm font-semibold text-white">{data.label}</span>
        </div>

        {data.task && (
          <p className="text-xs text-gray-400 truncate max-w-[120px]">
            {data.task}
          </p>
        )}

        {data.progress !== undefined && isActive && (
          <div className="mt-2 h-1 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full transition-all duration-500"
              style={{
                width: `${data.progress}%`,
                backgroundColor: color,
              }}
            />
          </div>
        )}

        {data.tokens !== undefined && (
          <p className="text-xs text-gray-500 mt-1">
            {data.tokens.toLocaleString()} tokens
          </p>
        )}
      </div>
    </div>
  );
}

// Orchestrator node (center)
function OrchestratorNode({ data }: { data: { mode: ExecutionMode; label: string } }) {
  const modeIcons: Record<ExecutionMode, typeof Users> = {
    council: Users,
    swarm: Zap,
    deliberation: GitCompare,
    debate: MessageSquare,
    single: Brain,
  };

  const Icon = modeIcons[data.mode] || Users;

  return (
    <div className="px-6 py-4 rounded-2xl border-2 border-orchestrator-accent bg-orchestrator-accent/20 shadow-xl">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-orchestrator-accent/30">
          <Icon size={24} className="text-orchestrator-accent" />
        </div>
        <div>
          <span className="text-sm font-bold text-white block">{data.label}</span>
          <span className="text-xs text-orchestrator-accent uppercase">{data.mode}</span>
        </div>
      </div>
    </div>
  );
}

const nodeTypes = {
  model: ModelNode,
  orchestrator: OrchestratorNode,
};

interface OrchestrationGraphProps {
  mode: ExecutionMode;
  activeModels: {
    provider: ModelProvider;
    name: string;
    status: 'idle' | 'active' | 'complete' | 'error';
    task?: string;
    progress?: number;
    tokens?: number;
  }[];
  connections?: { from: string; to: string; active?: boolean }[];
}

export function OrchestrationGraph({ mode, activeModels, connections = [] }: OrchestrationGraphProps) {
  // Create nodes
  const createNodes = useCallback((): Node[] => {
    const nodes: Node[] = [];
    const centerX = 300;
    const centerY = 200;
    const radius = 180;

    // Orchestrator node in center
    nodes.push({
      id: 'orchestrator',
      type: 'orchestrator',
      position: { x: centerX - 80, y: centerY - 30 },
      data: { mode, label: 'Chimera' },
    });

    // Model nodes in circle around orchestrator
    activeModels.forEach((model, index) => {
      const angle = (2 * Math.PI * index) / activeModels.length - Math.PI / 2;
      const x = centerX + radius * Math.cos(angle) - 70;
      const y = centerY + radius * Math.sin(angle) - 30;

      nodes.push({
        id: model.provider,
        type: 'model',
        position: { x, y },
        data: {
          label: model.name,
          provider: model.provider,
          status: model.status,
          task: model.task,
          progress: model.progress,
          tokens: model.tokens,
        },
        sourcePosition: Position.Left,
        targetPosition: Position.Right,
      });
    });

    return nodes;
  }, [mode, activeModels]);

  // Create edges
  const createEdges = useCallback((): Edge[] => {
    const edges: Edge[] = [];

    // Connect all models to orchestrator
    activeModels.forEach((model) => {
      const isActive = model.status === 'active';
      const color = modelColors[model.provider];

      edges.push({
        id: `${model.provider}-to-orch`,
        source: model.provider,
        target: 'orchestrator',
        animated: isActive,
        style: {
          stroke: isActive ? color : `${color}50`,
          strokeWidth: isActive ? 2 : 1,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isActive ? color : `${color}50`,
        },
      });

      edges.push({
        id: `orch-to-${model.provider}`,
        source: 'orchestrator',
        target: model.provider,
        animated: isActive,
        style: {
          stroke: isActive ? color : `${color}50`,
          strokeWidth: isActive ? 2 : 1,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isActive ? color : `${color}50`,
        },
      });
    });

    // Custom connections (e.g., model-to-model in deliberation)
    connections.forEach((conn) => {
      edges.push({
        id: `${conn.from}-${conn.to}`,
        source: conn.from,
        target: conn.to,
        animated: conn.active,
        style: {
          stroke: conn.active ? '#6366f1' : '#6366f150',
          strokeWidth: conn.active ? 2 : 1,
          strokeDasharray: '5,5',
        },
      });
    });

    return edges;
  }, [activeModels, connections]);

  const [nodes, setNodes, onNodesChange] = useNodesState(createNodes());
  const [edges, setEdges, onEdgesChange] = useEdgesState(createEdges());

  // Update nodes/edges when props change
  useEffect(() => {
    setNodes(createNodes());
    setEdges(createEdges());
  }, [activeModels, mode, connections, createNodes, createEdges, setNodes, setEdges]);

  return (
    <div className="h-[400px] w-full rounded-xl border border-orchestrator-border bg-orchestrator-bg overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        attributionPosition="bottom-left"
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1e1e2e" gap={20} />
        <Controls
          className="!bg-orchestrator-card !border-orchestrator-border"
          showInteractive={false}
        />
        <MiniMap
          nodeColor={(node) => {
            if (node.type === 'orchestrator') return '#6366f1';
            return modelColors[(node.data as ModelNodeData).provider] || '#6b7280';
          }}
          className="!bg-orchestrator-card !border-orchestrator-border"
        />
      </ReactFlow>
    </div>
  );
}

// Stats component
interface ModelStats {
  provider: ModelProvider;
  name: string;
  tokens: number;
  tasks: number;
  avgTime: number;
  contribution: number; // percentage
}

interface StatsProps {
  stats: ModelStats[];
  totalTokens: number;
  totalTasks: number;
}

export function ModelContributionStats({ stats, totalTokens, totalTasks }: StatsProps) {
  return (
    <div className="rounded-xl border border-orchestrator-border bg-orchestrator-card p-4">
      <h3 className="text-sm font-semibold text-white mb-4">Model Contributions</h3>

      <div className="space-y-3">
        {stats.sort((a, b) => b.contribution - a.contribution).map((stat) => (
          <div key={stat.provider} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: modelColors[stat.provider] }}
                />
                <span className="text-white">{stat.name}</span>
              </div>
              <span className="text-gray-400">{stat.contribution.toFixed(1)}%</span>
            </div>

            <div className="h-2 bg-orchestrator-border rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${stat.contribution}%`,
                  backgroundColor: modelColors[stat.provider],
                }}
              />
            </div>

            <div className="flex justify-between text-xs text-gray-500">
              <span>{stat.tokens.toLocaleString()} tokens</span>
              <span>{stat.tasks} tasks</span>
              <span>~{stat.avgTime.toFixed(1)}s avg</span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-orchestrator-border">
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Total</span>
          <span className="text-white font-medium">
            {totalTokens.toLocaleString()} tokens / {totalTasks} tasks
          </span>
        </div>
      </div>
    </div>
  );
}
