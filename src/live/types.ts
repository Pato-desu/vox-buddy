/** Contracts for the all-cloud "live" mode, where one Gemini Live session does hearing, thinking and speaking. */

export interface LiveConnectOptions {
  model: string;
  systemInstruction: string;
  voice: string;
  /** Resumption handle from the previous connection of the same call, so a reconnect keeps the conversation. */
  resumeHandle?: string;
}

/** What the cloud session tells us, already reduced from the wire messages. */
export interface LiveEvents {
  /** 24 kHz mono s16 audio of the reply. */
  onAudio(pcm: Int16Array): void;
  onInputText(text: string): void;
  onOutputText(text: string): void;
  /** The model finished its reply. */
  onTurnComplete(): void;
  /** The server cut the reply short because new input arrived. */
  onInterrupted(): void;
  onResumeHandle(handle: string): void;
  /** The server will drop this connection soon. */
  onGoAway(): void;
  onClose(reason?: string): void;
}

export interface LiveConnection {
  /** Marks the start of one person's speech; the server stops any reply in progress. */
  startActivity(): void;
  sendText(text: string): void;
  /** 16 kHz mono s16. */
  sendAudio(pcm: Int16Array): void;
  endActivity(): void;
  close(): void;
}

export type LiveConnector = (options: LiveConnectOptions, events: LiveEvents) => Promise<LiveConnection>;

/** Where the reply audio goes. The real one streams into a Discord voice connection. */
export interface LiveOutput {
  /** Appends 24 kHz mono s16 audio to the reply being played. */
  push(pcm: Int16Array): void;
  /** No more audio for this reply; playback finishes what it has. */
  end(): void;
  /** Cuts playback now and drops anything buffered. */
  stop(): void;
  readonly playing: boolean;
  whenIdle(): Promise<void>;
}
