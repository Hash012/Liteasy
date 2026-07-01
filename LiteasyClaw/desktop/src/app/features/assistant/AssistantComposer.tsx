import type { RefObject } from "react";

type AssistantComposerProps = {
  input: string;
  inputRef?: RefObject<HTMLTextAreaElement>;
  modeHint: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onVoiceInput: () => void;
  pending?: boolean;
  voiceInputMessage?: string;
};

export function AssistantComposer({
  input,
  inputRef,
  modeHint,
  onInputChange,
  onSend,
  onVoiceInput,
  pending = false,
  voiceInputMessage
}: AssistantComposerProps) {
  return (
    <div className="assistant-input-wrap">
      {pending ? <div className="assistant-command-feedback">AI 正在整理回答...</div> : null}
      {voiceInputMessage ? (
        <div className="assistant-voice-placeholder">{voiceInputMessage}</div>
      ) : null}
      <textarea
        className="assistant-input"
        ref={inputRef}
        onChange={(event) => onInputChange(event.target.value)}
        placeholder="输入你的问题或命令"
        rows={4}
        title={modeHint}
        value={input}
      />
      <div className="assistant-composer-actions">
        <button
          aria-label="语音输入（预留）"
          className="assistant-voice-button"
          onClick={onVoiceInput}
          type="button"
        >
          语音
        </button>
        <button className="assistant-send" type="button" onClick={onSend}>
          发送
        </button>
      </div>
    </div>
  );
}
