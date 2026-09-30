export interface AudioBufferData {
  data: Buffer;
  sampleRate: number;
  channels: number;
}

export interface SpeechToText {
  transcribe(audio: AudioBufferData | Buffer | string): Promise<string>;
  isAvailable(): Promise<boolean>;
}

export interface TextToSpeech {
  synthesize(text: string, voice?: string): Promise<Buffer>;
  isAvailable(): Promise<boolean>;
}

export interface WakeWordDetector {
  startListening(onWakeWordDetected: () => void): void;
  stopListening(): void;
  isListening(): boolean;
}

export interface VoiceSubsystem {
  stt?: SpeechToText;
  tts?: TextToSpeech;
  wakeWord?: WakeWordDetector;
  isEnabled(): boolean;
}
