export interface ImageInput {
  base64?: string;
  buffer?: Buffer;
  path?: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
}

export interface ScreenCaptureOptions {
  displayId?: number;
  format?: 'png' | 'jpeg';
}

export interface VisionProvider {
  name: string;
  isVisionSupported(modelName?: string): Promise<boolean>;
  describeImage(image: ImageInput, prompt: string): Promise<string>;
  captureScreen?(options?: ScreenCaptureOptions): Promise<ImageInput>;
}
