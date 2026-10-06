import { ToolRegistry } from '../tools/ToolRegistry.js';
import { MCPRegistry } from '../mcp/MCPRegistry.js';
import { TaskToolContext } from '../tools/TaskToolContext.js';
import { ITool, ToolResult, ToolExecutionContext } from '../tools/types.js';
import { MCPToolAdapter } from '../mcp/MCPToolAdapter.js';
import { Logger } from '../logger/Logger.js';
import { LLMProvider } from '../llm/types.js';

export interface ToolPlan {
    tools: string[];
    requiresDiscovery?: boolean;
    reasoning?: string;
}

export interface ToolPlannerOptions {
    tools: ToolRegistry;
    mcpRegistry?: MCPRegistry;
    llm?: LLMProvider;
}

export interface ReplanContext {
    prompt: string;
    context: TaskToolContext;
    executedTools: string[];
    lastToolName?: string;
    lastResult?: ToolResult;
}

export interface ReplanResult {
    addedTools: string[];
    reasoning?: string;
}

interface DiscoveredOperation {
    tool?: string;
    summary?: string;
    args?: string[];
    cud?: string;
}

/**
 * Puentes conceptuales para emparejar intenciones universales con herramientas del sistema.
 */
const ACTION_CONCEPTS: Record<string, string[]> = {
    NAVIGATE: [
        'abrir', 'abre', 'navegar', 'navega', 'navegador', 'entrar', 'visitar',
        'open', 'browse', 'browser', 'navigate', 'url', 'web', 'link', 'site', 'website', 'http', 'pagina', 'imdb'
    ],
    MEDIA: [
        'reproducir', 'reproduce', 'reproductor', 'poner', 'pon', 'escuchar', 'tocar', 'ver',
        'play', 'player', 'media', 'music', 'video', 'youtube', 'audio', 'song', 'cancion', 'musica', 'sonido'
    ],
    SEARCH: [
        'buscar', 'busca', 'busqueda', 'consultar', 'listar', 'lista', 'encontrar', 'ultimos', 'recientes',
        'search', 'find', 'query', 'list', 'lookup', 'google'
    ],
    FILE_IO: [
        'archivo', 'archivos', 'leer', 'lee', 'escribir', 'escribe', 'guardar', 'guarda', 'borrar', 'crear',
        'file', 'files', 'read', 'write', 'save', 'delete', 'directory', 'folder', 'path', 'disco', 'txt', 'pdf'
    ],
    EXEC: [
        'comando', 'terminal', 'consola', 'ejecutar', 'ejecuta', 'correr', 'shell', 'bash', 'cmd', 'powershell',
        'command', 'exec', 'execute', 'run'
    ],
    SYSTEM: [
        'volumen', 'audio', 'sonido', 'mute', 'silenciar', 'volume', 'sound',
        'ventana', 'ventanas', 'window', 'power', 'apagar', 'reiniciar', 'clipboard', 'portapapeles', 'copiar', 'pegar'
    ]
};

export class ToolPlanner {
    private tools: ToolRegistry;
    private mcpRegistry?: MCPRegistry;
    private llm?: LLMProvider;
    private logger = new Logger('ToolPlanner');

    // Cache interna de operaciones por server:tool
    private discoveryCache = new Map<string, DiscoveredOperation[]>();

    constructor(options: ToolPlannerOptions) {
        this.tools = options.tools;
        this.mcpRegistry = options.mcpRegistry;
        this.llm = options.llm;
    }

    /**
     * Determina las herramientas exactas para la tarea.
     */
    public async planInitialTools(
        prompt: string,
        context: TaskToolContext
    ): Promise<ToolPlan> {
        const plannedToolNames: string[] = [];
        const normalizedPrompt = this.normalize(prompt);

        // 1. Verificar si la tarea pide EXPLÍCITAMENTE un servicio MCP de forma inequívoca
        const matchedDiscovery = this.findExplicitMCPDiscoveryTool(normalizedPrompt);

        if (matchedDiscovery) {
            const { adapter, serverName } = matchedDiscovery;
            this.logger.info(`Detected explicit MCP service target: ${adapter.name} (server: ${serverName})`);

            const serviceTools = await this.resolveMCPDiscoveryOperations(
                serverName,
                adapter,
                normalizedPrompt,
                context
            );

            for (const toolName of serviceTools) {
                if (!plannedToolNames.includes(toolName)) {
                    plannedToolNames.push(toolName);
                }
            }

            // Si además pide explícitamente guardar en disco
            if (this.hasActiveConcept(normalizedPrompt, 'FILE_IO')) {
                const writeFileTool = this.tools.getTool('write_file');
                if (writeFileTool) {
                    context.addTool(writeFileTool);
                    plannedToolNames.push(writeFileTool.name);
                }
            }

            this.logger.info(
                `Initial tool plan generated (${plannedToolNames.length} tool${plannedToolNames.length === 1 ? '' : 's'
                }): [${plannedToolNames.join(', ')}]`
            );

            return {
                tools: plannedToolNames,
                requiresDiscovery: false,
                reasoning: `Planned concrete tools via ${adapter.name}.`,
            };
        }

        // 2. Si no es un servicio MCP explícito, las herramientas locales son prioritarias
        const localTools = this.selectRelevantLocalTools(normalizedPrompt);

        for (const tool of localTools) {
            if (!context.getTool(tool.name)) {
                context.addTool(tool);
            }
            if (!plannedToolNames.includes(tool.name)) {
                plannedToolNames.push(tool.name);
            }
        }

        // 3. Fallback inteligente solo si no se seleccionó ninguna herramienta y no es conversacional
        if (
            plannedToolNames.length === 0 &&
            !this.isPurelyConversational(normalizedPrompt)
        ) {
            const fallbackTools = this.getFallbackTools(normalizedPrompt);
            for (const tool of fallbackTools) {
                if (!context.getTool(tool.name)) {
                    context.addTool(tool);
                }
                if (!plannedToolNames.includes(tool.name)) {
                    plannedToolNames.push(tool.name);
                }
            }
        }

        this.logger.info(
            `Initial tool plan generated (${plannedToolNames.length} tool${plannedToolNames.length === 1 ? '' : 's'
            }): [${plannedToolNames.join(', ')}]`
        );

        return {
            tools: plannedToolNames,
            requiresDiscovery: false,
            reasoning: `Planned local tools based on semantic relevance.`,
        };
    }

    /**
     * Re-planificación incremental tras observar resultados de herramientas anteriores.
     */
    public async replan(params: ReplanContext): Promise<ReplanResult> {
        const addedTools: string[] = [];
        const normalizedPrompt = this.normalize(params.prompt);

        // Si ejecutó una búsqueda y requiere leer contenido
        if (
            params.lastToolName?.includes('search') &&
            params.lastResult?.success
        ) {
            const wantsRead =
                /\b(leer|lee|abrir|abre|ver|contenido|cuerpo|mensaje|read)\b/i.test(normalizedPrompt);

            if (wantsRead) {
                for (const [cacheKey, ops] of this.discoveryCache.entries()) {
                    const [serverName] = cacheKey.split(':');
                    const client = this.mcpRegistry?.getClient(serverName);
                    if (!client) continue;

                    const readOp = ops.find((op) =>
                        (op.tool ?? '').includes('read') || (op.tool ?? '').includes('get')
                    );

                    if (readOp?.tool) {
                        const fullName = `${serverName}__${readOp.tool}`;
                        if (!params.context.getTool(fullName)) {
                            const adapter = this.buildDiscoveredAdapter(client, serverName, readOp);
                            params.context.addTool(adapter);
                            addedTools.push(adapter.name);
                            this.logger.info(`Planner incrementally added tool: ${adapter.name}`);
                        }
                    }
                }
            }
        }

        return {
            addedTools,
            reasoning:
                addedTools.length > 0
                    ? `Incrementally activated tools: ${addedTools.join(', ')}`
                    : undefined,
        };
    }

    /**
     * Permite incorporar dinámicamente cualquier herramienta registrada si el modelo la invoca.
     */
    public resolveTool(toolName: string, context: TaskToolContext): boolean {
        const tool = this.tools.getTool(toolName);
        if (tool) {
            context.addTool(tool);
            this.logger.info(
                `Dynamically resolved and added local tool "${toolName}" into task context.`
            );
            return true;
        }
        return false;
    }

    // ---------------------------------------------------------------------------
    // DETECCIÓN ESTRICTA DE SERVICIOS MCP (Anti-Secuestro)
    // ---------------------------------------------------------------------------

    /**
     * Verifica si la solicitud apunta explícitamente a un servicio MCP específico.
     * Evita que palabras genéricas como 'web' o 'search' disparen herramientas como Search Console.
     */
    private findExplicitMCPDiscoveryTool(prompt: string): {
        adapter: MCPToolAdapter;
        serverName: string;
    } | null {
        if (!this.mcpRegistry) return null;

        // Reglas de dominio estricto por servicio MCP
        const domainMatchers: Array<{ pattern: RegExp; discoveryKey: string }> = [
            { pattern: /\b(gmail|mail|mails|correo|correos|email|emails|bandeja|inbox)\b/i, discoveryKey: 'gmail_discover' },
            { pattern: /\b(calendar|calendario|evento|eventos|cita|citas|agenda)\b/i, discoveryKey: 'calendar_discover' },
            { pattern: /\b(google drive|gdrive|archivos de drive|carpeta de drive)\b/i, discoveryKey: 'drive_discover' },
            { pattern: /\b(google sheets|sheets|hoja de calculo|hojas de calculo|spreadsheet)\b/i, discoveryKey: 'sheets_discover' },
            { pattern: /\b(google docs|documento de google|documentos de google)\b/i, discoveryKey: 'docs_discover' },
            { pattern: /\b(google contacts|contactos de google|libreta de direcciones)\b/i, discoveryKey: 'contacts_discover' },
            { pattern: /\b(search console|searchconsole|google search console|sitemaps)\b/i, discoveryKey: 'searchconsole_discover' },
            { pattern: /\b(google tasks|tareas de google)\b/i, discoveryKey: 'tasks_discover' },
            { pattern: /\b(google meet|videollamada de meet)\b/i, discoveryKey: 'meet_discover' },
        ];

        for (const matcher of domainMatchers) {
            if (matcher.pattern.test(prompt)) {
                for (const serverName of this.mcpRegistry.getServerNames()) {
                    const serverTools = this.mcpRegistry.getTools(serverName);
                    const found = serverTools.find((t) =>
                        t.name.toLowerCase().includes(matcher.discoveryKey.toLowerCase())
                    );
                    if (found) {
                        return { adapter: found, serverName };
                    }
                }
            }
        }

        return null;
    }

    // ---------------------------------------------------------------------------
    // MOTOR DE PONDERACIÓN Y RECUPERACIÓN DE HERRAMIENTAS LOCALES
    // ---------------------------------------------------------------------------

    private selectRelevantLocalTools(prompt: string): ITool[] {
        const promptTokens = this.extractTokens(prompt);
        const localTools = this.tools
            .getAllTools()
            .filter((t) => !t.name.includes('__'));

        const scored = localTools
            .map((tool) => {
                const paramsObj = (tool.parameters as any)?.properties;
                const score = this.scoreToolRelevance(
                    tool.name,
                    tool.description,
                    paramsObj,
                    promptTokens,
                    prompt
                );
                return { tool, score };
            })
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score);

        // Retorna hasta 6 herramientas para que acciones compuestas
        // (ej. buscar y abrir la web) tengan disponibles tanto 'web_search' como 'open_url' y 'browse_web'.
        return scored.slice(0, 6).map((item) => item.tool);
    }

    private scoreToolRelevance(
        name: string,
        description: string,
        parametersObj: Record<string, unknown> | undefined,
        promptTokens: string[],
        prompt: string
    ): number {
        const normName = this.normalize(name);
        const normDesc = this.normalize(description);
        const nameParts = normName.split(/[_-]/).filter((p) => p.length >= 2);

        let score = 0;

        // 1. Coincidencia directa del nombre de la herramienta o sus partes en el prompt
        for (const part of nameParts) {
            if (prompt.includes(part)) {
                score += 15;
            }
        }

        // 2. Evaluación de tokens y similitud difusa (Trigrams)
        for (const token of promptTokens) {
            if (token.length < 3) continue;

            if (normName.includes(token)) score += 12;
            if (normDesc.includes(token)) score += 4;

            for (const part of nameParts) {
                const sim = this.trigramSimilarity(token, part);
                if (sim >= 0.7) score += 10 * sim;
            }

            const descWords = normDesc.split(/\s+/).filter((w) => w.length >= 4);
            for (const dw of descWords) {
                if (this.trigramSimilarity(token, dw) >= 0.8) {
                    score += 3;
                    break;
                }
            }
        }

        // 3. Activación por conceptos de acción
        for (const [, conceptTerms] of Object.entries(ACTION_CONCEPTS)) {
            const promptHasConcept = conceptTerms.some((term) => prompt.includes(term));
            if (!promptHasConcept) continue;

            const toolHasConcept = conceptTerms.some(
                (term) => normName.includes(term) || normDesc.includes(term)
            );

            if (toolHasConcept) {
                score += 8;
            }
        }

        // 4. Ponderación por parámetros
        if (parametersObj && typeof parametersObj === 'object') {
            const paramNames = Object.keys(parametersObj).map((p) => this.normalize(p));
            for (const pName of paramNames) {
                if (prompt.includes(pName)) {
                    score += 5;
                }
            }
        }

        return score;
    }

    private trigramSimilarity(a: string, b: string): number {
        if (a === b) return 1.0;
        if (a.length < 3 || b.length < 3) {
            return a.includes(b) || b.includes(a) ? 0.8 : 0.0;
        }

        const trigramsA = new Set<string>();
        for (let i = 0; i <= a.length - 3; i++) {
            trigramsA.add(a.substring(i, i + 3));
        }

        let matches = 0;
        const totalB = b.length - 2;
        for (let i = 0; i <= totalB - 1; i++) {
            if (trigramsA.has(b.substring(i, i + 3))) {
                matches++;
            }
        }

        return (2.0 * matches) / (trigramsA.size + totalB);
    }

    private hasActiveConcept(prompt: string, conceptName: string): boolean {
        const terms = ACTION_CONCEPTS[conceptName];
        if (!terms) return false;
        return terms.some((t) => prompt.includes(t));
    }

    // ---------------------------------------------------------------------------
    // RESOLUCIÓN DE DISCOVERY MCP
    // ---------------------------------------------------------------------------

    private async resolveMCPDiscoveryOperations(
        serverName: string,
        discoveryAdapter: MCPToolAdapter,
        prompt: string,
        context: TaskToolContext
    ): Promise<string[]> {
        const client = this.mcpRegistry?.getClient(serverName);
        if (!client) return [];

        const cacheKey = `${serverName}:${discoveryAdapter.name}`;
        let operations = this.discoveryCache.get(cacheKey);

        if (!operations) {
            this.logger.info(`Running internal MCP discovery via ${discoveryAdapter.name}`);

            const execContext: ToolExecutionContext = {
                workspaceRoot: '',
                requestApproval: async () => true,
            };

            const discResult = await discoveryAdapter.execute({ query: '' }, execContext);

            if (discResult.success && discResult.data) {
                operations = this.parseDiscoveryPayload(discResult.data);
                this.discoveryCache.set(cacheKey, operations);
            } else {
                this.logger.warn(`Discovery failed on ${discoveryAdapter.name}: ${discResult.error}`);
                operations = [];
            }
        }

        this.logger.info(`Discovered ${operations.length} operations from ${discoveryAdapter.name}`);
        if (operations.length === 0) return [];

        const promptTokens = this.extractTokens(prompt);

        const scoredOperations = operations
            .filter((op) => op.tool)
            .map((op) => {
                const score = this.scoreToolRelevance(
                    op.tool!,
                    op.summary ?? '',
                    op.args ? Object.fromEntries(op.args.map((a) => [a, 'string'])) : undefined,
                    promptTokens,
                    prompt
                );
                return { op, score };
            })
            .sort((a, b) => b.score - a.score);

        const best = scoredOperations.filter((item) => item.score > 0);
        const selectedOps = best.length > 0 ? [best[0].op] : [operations[0]];

        const addedToolNames: string[] = [];
        for (const op of selectedOps) {
            if (!op.tool) continue;

            this.logger.info(`Selected operation: ${op.tool}`);
            const adapter = this.buildDiscoveredAdapter(client, serverName, op);
            context.addTool(adapter);
            addedToolNames.push(adapter.name);
        }

        return addedToolNames;
    }

    private buildDiscoveredAdapter(
        client: any,
        serverName: string,
        op: DiscoveredOperation
    ): MCPToolAdapter {
        const properties: Record<string, unknown> = {};
        for (const arg of op.args ?? []) {
            properties[arg] = {
                type: 'string',
                description: `Argumento ${arg}`,
            };
        }

        return new MCPToolAdapter(client, {
            name: op.tool!,
            description: op.summary ?? `MCP tool ${op.tool}`,
            inputSchema: {
                type: 'object',
                properties,
            },
        });
    }

    private getFallbackTools(prompt: string): ITool[] {
        const candidates: ITool[] = [];

        if (this.hasActiveConcept(prompt, 'NAVIGATE') || this.hasActiveConcept(prompt, 'SEARCH')) {
            const openUrl = this.tools.getTool('open_url');
            if (openUrl) candidates.push(openUrl);
            const browseWeb = this.tools.getTool('browse_web');
            if (browseWeb) candidates.push(browseWeb);
            const webSearch = this.tools.getTool('web_search');
            if (webSearch) candidates.push(webSearch);
        }

        if (this.hasActiveConcept(prompt, 'MEDIA')) {
            const media = this.tools.getTool('control_media');
            if (media && !candidates.includes(media)) candidates.push(media);
        }

        if (this.hasActiveConcept(prompt, 'FILE_IO')) {
            const readFile = this.tools.getTool('read_file');
            if (readFile && !candidates.includes(readFile)) candidates.push(readFile);
        }

        return candidates;
    }

    private isPurelyConversational(prompt: string): boolean {
        return /^(hola|buenas|buenos dias|buenas tardes|que tal|como estas|gracias|muchas gracias|de nada|adios|chau|listo|ok|entendido)$/i.test(
            prompt.trim()
        );
    }

    private parseDiscoveryPayload(data: unknown): DiscoveredOperation[] {
        try {
            const raw = typeof data === 'string' ? data : JSON.stringify(data);
            const parsed = JSON.parse(raw);

            if (Array.isArray(parsed)) return parsed;
            if (Array.isArray(parsed.operations)) return parsed.operations;
            if (Array.isArray(parsed.tools)) return parsed.tools;
        } catch {
            // Ignorar error de parsing
        }
        return [];
    }

    private normalize(value: string): string {
        return value
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9_\s-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private extractTokens(value: string): string[] {
        const stopWords = new Set([
            'de', 'la', 'el', 'en', 'por', 'los', 'las', 'un', 'una', 'para',
            'con', 'al', 'del', 'que', 'los', 'mis', 'tus', 'sus', 'este', 'esta'
        ]);

        return this.normalize(value)
            .split(/\s+/)
            .filter((token) => token.length >= 3 && !stopWords.has(token));
    }
}