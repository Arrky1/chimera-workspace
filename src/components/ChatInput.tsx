'use client';

import { useState, useRef, useEffect, useCallback, KeyboardEvent } from 'react';
import { Send, Image, Paperclip, Mic, MicOff, Loader2 } from 'lucide-react';

interface ChatInputProps {
  onSubmit: (message: string, attachments?: File[]) => void;
  isProcessing: boolean;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  queueLength?: number;
}

export function ChatInput({ onSubmit, isProcessing, placeholder, value, onChange, queueLength }: ChatInputProps) {
  const [localInput, setLocalInput] = useState('');
  const input = value !== undefined ? value : localInput;
  const setInput = onChange || setLocalInput;
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isListening, setIsListening] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Web Speech API for voice input
  const toggleVoice = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;
    if (!win.webkitSpeechRecognition && !win.SpeechRecognition) {
      alert('Голосовой ввод не поддерживается в этом браузере');
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognitionAPI = win.SpeechRecognition || win.webkitSpeechRecognition;
    const recognition = new SpeechRecognitionAPI();
    recognition.lang = 'ru-RU';
    recognition.continuous = true;
    recognition.interimResults = true;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setInput(transcript);
    };

    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [isListening, setInput]);

  useEffect(() => {
    return () => { recognitionRef.current?.stop(); };
  }, []);

  const handleSubmit = () => {
    if (!input.trim() && attachments.length === 0) return;

    onSubmit(input, attachments.length > 0 ? attachments : undefined);
    setInput('');
    setAttachments([]);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setAttachments([...attachments, ...Array.from(e.target.files)]);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments(attachments.filter((_, i) => i !== index));
  };

  return (
    <div className="border-t border-orchestrator-border bg-orchestrator-card p-4">
      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {attachments.map((file, index) => (
            <div
              key={index}
              className="flex items-center gap-2 rounded-lg bg-orchestrator-bg px-3 py-2 text-sm"
            >
              <span className="max-w-[150px] truncate">{file.name}</span>
              <button
                onClick={() => removeAttachment(index)}
                className="text-gray-400 hover:text-white"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="flex items-end gap-3">
        <div className="flex-1 rounded-xl border border-orchestrator-border bg-orchestrator-bg p-3">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              // Auto-resize
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder || 'Опишите задачу или перетащите файлы...'}
            rows={3}
            className="w-full resize-none bg-transparent text-white placeholder-gray-500 focus:outline-none"
            style={{ minHeight: '72px', maxHeight: '160px' }}
          />

          {/* Action buttons */}
          <div className="mt-2 flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.txt,.md,.json,.js,.ts,.py"
              onChange={handleFileSelect}
              className="hidden"
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-orchestrator-border hover:text-white"
              title="Прикрепить файл"
            >
              <Paperclip size={18} />
            </button>

            <button
              onClick={() => {
                if (fileInputRef.current) {
                  fileInputRef.current.accept = 'image/*';
                  fileInputRef.current.click();
                  fileInputRef.current.accept = 'image/*,.pdf,.txt,.md,.json,.js,.ts,.py';
                }
              }}
              className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-orchestrator-border hover:text-white"
              title="Добавить скриншот"
            >
              <Image size={18} />
            </button>

            <button
              onClick={toggleVoice}
              className={`rounded-lg p-2 transition-colors ${
                isListening
                  ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                  : 'text-gray-400 hover:bg-orchestrator-border hover:text-white'
              }`}
              title={isListening ? 'Остановить запись' : 'Голосовой ввод'}
            >
              {isListening ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
          </div>
        </div>

        {/* Send button */}
        <button
          onClick={handleSubmit}
          disabled={!input.trim() && attachments.length === 0}
          className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-orchestrator-accent text-white transition-all hover:bg-orchestrator-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send size={20} />
          {!!queueLength && queueLength > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-yellow-500 text-[10px] font-bold text-black">
              {queueLength}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
