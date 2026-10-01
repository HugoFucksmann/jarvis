import fs from 'fs';
import path from 'path';
import { BaseTool } from '../Tool.js';
import { RiskLevel, ToolExecutionContext, ToolResult } from '../types.js';
import { OllamaVisionProvider } from '../../modalities/OllamaVision.js';
import { config } from '../../config/index.js';

// Shared instance of OllamaVisionProvider
let sharedVisionProvider: OllamaVisionProvider | null = null;

export function getSharedVisionProvider(): OllamaVisionProvider {
  if (!sharedVisionProvider) {
    sharedVisionProvider = new OllamaVisionProvider(
      config.ollama.baseUrl,
      config.vision.model,
      config.vision.device,
      {
        keepAlive: config.vision.keepAlive,
        maxWidth: config.vision.maxWidth,
        quality: config.vision.quality,
      }
    );
  }
  return sharedVisionProvider;
}

export class TakeScreenshotTool extends BaseTool {
  readonly name = 'take_screenshot';
  readonly description =
    'Captura la pantalla completa o la ventana activa actual de la PC. Opcionalmente analiza visualmente el contenido de la captura con visión artificial multimodal (ideal para diagnosticar errores visuales, verificar interfaces, describir lo que el usuario ve o leer textos en pantalla).';
  readonly riskLevel = RiskLevel.LOW;
  readonly requiredPermissions = ['system:screen'];
  readonly parameters = {
    type: 'object' as const,
    properties: {
      target: {
        type: 'string',
        enum: ['screen', 'active_window'],
        description:
          'Área a capturar: "screen" (monitor principal completo, por defecto) o "active_window" (únicamente la ventana activa en primer plano).',
      },
      analyzePrompt: {
        type: 'string',
        description:
          'Pregunta o instrucción opcional para analizar visualmente la captura con el modelo de visión local (ej: "¿Qué mensaje de error aparece?", "¿Qué aplicación está abierta?", "Describe lo que ves").',
      },
      savePath: {
        type: 'string',
        description:
          'Ruta personalizada opcional de destino para guardar la imagen (por defecto se guarda en .jarvis/screenshots/).',
      },
    },
    required: [],
  };

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    const target = (args.target as 'screen' | 'active_window') || 'screen';
    const analyzePrompt = ((args.analyzePrompt as string) || '').trim();
    const savePath = (args.savePath as string) || undefined;

    try {
      const vision = getSharedVisionProvider();
      const captureResult = await vision.captureScreen({
        target,
        savePath,
      });

      let visualAnalysis: string | undefined;

      if (analyzePrompt) {
        try {
          visualAnalysis = await vision.describeImage(
            { path: captureResult.path },
            analyzePrompt
          );
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          visualAnalysis = `[Aviso: No se pudo completar el análisis multimodal: ${errMsg}]`;
        }
      }

      const relativePath = path.relative(context.workspaceRoot, captureResult.path);

      return {
        success: true,
        data: {
          message: `Captura de ${target === 'active_window' ? 'la ventana activa' : 'pantalla completa'} realizada con éxito.`,
          path: captureResult.path,
          relativePath,
          dimensions: `${captureResult.width}x${captureResult.height}`,
          fileSizeBytes: captureResult.fileSizeBytes,
          target: captureResult.target,
          timestamp: captureResult.timestamp,
          analysis: visualAnalysis,
        },
      };
    } catch (err: unknown) {
      return {
        success: false,
        error: `Fallo al capturar pantalla: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}

export class AnalyzeImageTool extends BaseTool {
  readonly name = 'analyze_image';
  readonly description =
    'Analiza cualquier archivo de imagen existente en el disco (diagramas, capturas de pantalla, fotos, esquemas, documentos o mockups) mediante el modelo de visión multimodal local, respondiendo a una pregunta o directiva sobre su contenido.';
  readonly riskLevel = RiskLevel.LOW;
  readonly requiredPermissions = ['filesystem:read'];
  readonly parameters = {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'Ruta absoluta o relativa al archivo de imagen en el disco (formatos: png, jpg, jpeg, webp).',
      },
      prompt: {
        type: 'string',
        description: 'Pregunta, directiva o instrucción específica sobre lo que se desea analizar de la imagen.',
      },
    },
    required: ['path', 'prompt'],
  };

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    const rawPath = (args.path as string) || '';
    const prompt = ((args.prompt as string) || '').trim();

    if (!rawPath) {
      return { success: false, error: 'Se requiere el parámetro "path" con la ruta de la imagen.' };
    }
    if (!prompt) {
      return { success: false, error: 'Se requiere el parámetro "prompt" con la instrucción para el análisis visual.' };
    }

    const resolvedPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(context.workspaceRoot, rawPath);

    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: `El archivo de imagen no existe en la ruta: ${resolvedPath}` };
    }

    try {
      const vision = getSharedVisionProvider();
      const analysis = await vision.describeImage({ path: resolvedPath }, prompt);

      return {
        success: true,
        data: {
          path: resolvedPath,
          prompt,
          analysis,
        },
      };
    } catch (err: unknown) {
      return {
        success: false,
        error: `Error analizando la imagen: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
