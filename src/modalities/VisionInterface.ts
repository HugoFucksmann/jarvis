export interface ImageInput {
  base64?: string;
  buffer?: Buffer;
  path?: string;
  mimeType?: 'image/png' | 'image/jpeg' | 'image/webp';
}

export interface ScreenCaptureOptions {
  target?: 'screen' | 'active_window';
  displayId?: number;
  format?: 'png' | 'jpeg';
  quality?: number;
  maxWidth?: number;
  savePath?: string;
}

export interface ScreenCaptureResult {
  path: string;
  base64: string;
  mimeType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  target: 'screen' | 'active_window';
  timestamp: string;
  fileSizeBytes: number;
}

export interface VisionProvider {
  name: string;
  isVisionSupported(modelName?: string): Promise<boolean>;
  describeImage(image: ImageInput, prompt: string): Promise<string>;
  captureScreen(options?: ScreenCaptureOptions): Promise<ScreenCaptureResult>;
}
