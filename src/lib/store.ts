import { create } from 'zustand';
import { Message, ExecutionPlan, ClarificationRequest, ModelConfig, OrchestratorState } from '@/types';
import { getAvailableModels } from './models';

export const useOrchestratorStore = create<OrchestratorState>((set, get) => ({
  messages: [],
  currentPlan: null,
  pendingClarification: null,
  isProcessing: false,
  models: getAvailableModels(),

  addMessage: (message) => {
    const newMessage: Message = {
      ...message,
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: new Date(),
    };
    set((state) => ({
      messages: [...state.messages, newMessage],
    }));
  },

  setCurrentPlan: (plan) => {
    set({ currentPlan: plan });
  },

  setPendingClarification: (clarification) => {
    set({ pendingClarification: clarification });
  },

  setProcessing: (processing) => {
    set({ isProcessing: processing });
  },

  updatePhaseStatus: (phaseId, status, progress) => {
    set((state) => {
      if (!state.currentPlan) return state;

      const updatedPhases = state.currentPlan.phases.map((phase) =>
        phase.id === phaseId
          ? { ...phase, status, progress: progress ?? phase.progress }
          : phase
      );

      return {
        currentPlan: {
          ...state.currentPlan,
          phases: updatedPhases,
        },
      };
    });
  },
}));
