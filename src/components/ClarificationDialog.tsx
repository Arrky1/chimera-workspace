'use client';

import { useState } from 'react';
import { ClarificationRequest, ClarificationQuestion } from '@/types';
import { HelpCircle, Check } from 'lucide-react';

interface ClarificationDialogProps {
  request: ClarificationRequest;
  onSubmit: (answers: Record<string, string>) => void;
}

export function ClarificationDialog({ request, onSubmit }: ClarificationDialogProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});

  const handleOptionSelect = (questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const handleCustomInput = (questionId: string, value: string) => {
    setCustomInputs((prev) => ({ ...prev, [questionId]: value }));
    setAnswers((prev) => ({ ...prev, [questionId]: `custom:${value}` }));
  };

  const handleSubmit = () => {
    // Process answers, replacing custom: prefix with actual values
    const processedAnswers: Record<string, string> = {};
    for (const [key, value] of Object.entries(answers)) {
      if (value.startsWith('custom:')) {
        processedAnswers[key] = customInputs[key] || '';
      } else {
        // Find the label for the selected option
        const question = request.questions.find((q) => q.id === key);
        const option = question?.options.find((o) => o.value === value);
        processedAnswers[key] = option?.label || value;
      }
    }
    onSubmit(processedAnswers);
  };

  const allAnswered = request.questions.every((q) => answers[q.id]);

  return (
    <div className="rounded-xl border border-orchestrator-accent/30 bg-orchestrator-accent/5 p-4">
      <div className="mb-3 flex items-center gap-2 text-orchestrator-accent">
        <HelpCircle size={18} />
        <span className="font-medium">Уточняющие вопросы</span>
      </div>

      <p className="mb-4 text-sm text-gray-400">{request.context}</p>

      <div className="space-y-4">
        {request.questions.map((question) => (
          <QuestionBlock
            key={question.id}
            question={question}
            selectedValue={answers[question.id]}
            customValue={customInputs[question.id]}
            onSelect={(value) => handleOptionSelect(question.id, value)}
            onCustomInput={(value) => handleCustomInput(question.id, value)}
          />
        ))}
      </div>

      <button
        onClick={handleSubmit}
        disabled={!allAnswered}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-orchestrator-accent px-4 py-2 font-medium text-white transition-all hover:bg-orchestrator-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Check size={18} />
        Подтвердить
      </button>
    </div>
  );
}

interface QuestionBlockProps {
  question: ClarificationQuestion;
  selectedValue?: string;
  customValue?: string;
  onSelect: (value: string) => void;
  onCustomInput: (value: string) => void;
}

function QuestionBlock({
  question,
  selectedValue,
  customValue,
  onSelect,
  onCustomInput,
}: QuestionBlockProps) {
  const isCustomSelected = selectedValue?.startsWith('custom:');

  return (
    <div className="space-y-2">
      <p className="font-medium text-white">{question.question}</p>

      <div className="space-y-2">
        {question.options.map((option) => (
          <label
            key={option.value}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-all ${
              selectedValue === option.value
                ? 'border-orchestrator-accent bg-orchestrator-accent/10'
                : 'border-orchestrator-border hover:border-orchestrator-accent/50'
            }`}
          >
            <input
              type="radio"
              name={question.id}
              value={option.value}
              checked={selectedValue === option.value}
              onChange={() => onSelect(option.value)}
              className="mt-1 accent-orchestrator-accent"
            />
            <div>
              <span className="text-white">
                {option.label}
                {option.recommended && (
                  <span className="ml-2 text-xs text-orchestrator-accent">
                    (рекомендуется)
                  </span>
                )}
              </span>
              {option.description && (
                <p className="mt-1 text-sm text-gray-400">{option.description}</p>
              )}
            </div>
          </label>
        ))}

        {question.allowCustom && (
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-all ${
              isCustomSelected
                ? 'border-orchestrator-accent bg-orchestrator-accent/10'
                : 'border-orchestrator-border hover:border-orchestrator-accent/50'
            }`}
          >
            <input
              type="radio"
              name={question.id}
              checked={isCustomSelected}
              onChange={() => onSelect('custom:')}
              className="mt-1 accent-orchestrator-accent"
            />
            <div className="flex-1">
              <span className="text-white">Другое</span>
              {isCustomSelected && (
                <input
                  type="text"
                  value={customValue || ''}
                  onChange={(e) => onCustomInput(e.target.value)}
                  placeholder="Введите свой вариант..."
                  className="mt-2 w-full rounded-lg border border-orchestrator-border bg-orchestrator-bg px-3 py-2 text-white placeholder-gray-500 focus:border-orchestrator-accent focus:outline-none"
                  autoFocus
                />
              )}
            </div>
          </label>
        )}
      </div>
    </div>
  );
}
