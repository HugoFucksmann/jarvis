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

interface ServiceRule {
    service: string;
    server: string;
    discoveryToolPattern: string;
    displayName: string;
    keywords: RegExp;
}

const SERVICE_RULES: ServiceRule[] = [
    {
        service: 'gmail',
        server: 'google',
        discoveryToolPattern: 'gmail_discover',
        displayName: 'Gmail',
        keywords:
            /\b(gmail|mail|mails|correo|correos|email|emails|bandeja|inbox|mensaje|mensajes)\b/i,
    },
    {
        service: 'calendar',
        server: 'google',
        discoveryToolPattern: 'calendar_discover',
        displayName: 'Calendar',
        keywords:
            /\b(calendar|calendario|evento|eventos|cita|citas|reunion|reuniones|agenda)\b/i,
    },
    {
        service: 'drive',
        server: 'google',
        discoveryToolPattern: 'drive_discover',
        displayName: 'Drive',
        keywords:
            /\b(drive|google drive|archivo en drive|archivos en drive|archivos de drive|carpeta de drive)\b/i,
    },
    {
        service: 'sheets',
        server: 'google',
        discoveryToolPattern: 'sheets_discover',
        displayName: 'Sheets',
        keywords:
            /\b(sheets|hoja de calculo|hojas de calculo|spreadsheet|spreadsheets|planilla|planillas|excel)\b/i,
    },
    {
        service: 'docs',
        server: 'google',
        discoveryToolPattern: 'docs_discover',
        displayName: 'Docs',
        keywords:
            /\b(docs|google docs|documento de google|documentos de google)\b/i,
    },
    {
        service: 'contacts',
        server: 'google',
        discoveryToolPattern: 'contacts_discover',
        displayName: 'Contacts',
        keywords:
            /\b(contacts|contactos|contacto|libreta de direcciones)\b/i,
    },
    {
        service: 'tasks',
        server: 'google',
        discoveryToolPattern: 'tasks_discover',
        displayName: 'Tasks',
        keywords:
            /\b(tasks|google tasks|tareas de google)\b/i,
    },
    {
        service: 'meet',
        server: 'google',
        discoveryToolPattern: 'meet_discover',
        displayName: 'Meet',
        keywords:
            /\b(meet|google meet|videollamada|videollamadas)\b/i,
    },
];

export class ToolPlanner {
    private tools: ToolRegistry;
    private mcpRegistry?: MCPRegistry;
    private llm?: LLMProvider;
    private logger = new Logger('ToolPlanner');

    // Cache interna de operaciones por servicio para evitar re-consultas en llamadas incrementales
    private discoveryCache = new Map<string, DiscoveredOperation[]>();

    constructor(options: ToolPlannerOptions) {
        this.tools = options.tools;
        this.mcpRegistry = options.mcpRegistry;
        this.llm = options.llm;
    }

    /**
     * Planifica las herramientas mínimas e indispensables para cumplir la tarea.
     */
    public async planInitialTools(
        prompt: string,
        context: TaskToolContext
    ): Promise<ToolPlan> {
        const plannedToolNames: string[] = [];
        const normalizedPrompt = this.normalize(prompt);

        // 1. Detectar si la tarea apunta a un servicio MCP específico
        const matchedServices = this.detectMatchedServices(normalizedPrompt);

        if (matchedServices.length > 0) {
            for (const rule of matchedServices) {
                this.logger.info(`Detected service: ${rule.service}`);
                this.logger.info(`Selected MCP server: ${rule.server}`);

                const serviceTools = await this.resolveServiceOperations(
                    rule,
                    normalizedPrompt,
                    context
                );

                for (const toolName of serviceTools) {
                    if (!plannedToolNames.includes(toolName)) {
                        plannedToolNames.push(toolName);
                    }
                }
            }

            // Si se encontró un servicio específico (ej. Gmail), NO se agregan herramientas locales
            // ni fallbacks genéricos a menos que el usuario haya pedido explícitamente persistencia local.
            const requiresLocalFile =
                /\b(guardar en disco|guardalo en un archivo|escribir archivo|guardar en txt)\b/i.test(
                    normalizedPrompt
                );

            if (requiresLocalFile) {
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
                reasoning: `Planned ${plannedToolNames.length} specific tool(s) for service: ${matchedServices
                    .map((s) => s.displayName)
                    .join(', ')}`,
            };
        }

        // 2. Tarea sin servicio MCP específico: Evaluar herramientas locales
        const localTools = this.selectRelevantLocalTools(normalizedPrompt);
        for (const tool of localTools) {
            if (!context.getTool(tool.name)) {
                context.addTool(tool);
            }
            if (!plannedToolNames.includes(tool.name)) {
                plannedToolNames.push(tool.name);
            }
        }

        // 3. Fallback genérico únicamente si no hay herramientas seleccionadas y NO es puramente conversacional
        if (
            plannedToolNames.length === 0 &&
            !this.isPurelyConversational(normalizedPrompt)
        ) {
            const fallbackTools = this.selectGenericFallback(normalizedPrompt);
            for (const tool of fallbackTools) {
                context.addTool(tool);
                plannedToolNames.push(tool.name);
            }
        }

        this.logger.info(
            `Initial tool plan generated (${plannedToolNames.length} tool${plannedToolNames.length === 1 ? '' : 's'
            }): [${plannedToolNames.join(', ')}]`
        );

        return {
            tools: plannedToolNames,
            requiresDiscovery: false,
            reasoning: `Planned local/fallback tools for prompt.`,
        };
    }

    /**
     * Re-planificación incremental tras observar resultados de herramientas anteriores.
     */
    public async replan(params: ReplanContext): Promise<ReplanResult> {
        const addedTools: string[] = [];
        const normalizedPrompt = this.normalize(params.prompt);

        // Si ejecutó una búsqueda en Gmail y el prompt también requería leer o abrir el contenido
        if (
            params.lastToolName === 'google__gmail_search' &&
            params.lastResult?.success
        ) {
            const hasReadIntent =
                /\b(leer|lee|abrir|abre|ver|contenido|cuerpo|mensaje|read)\b/i.test(
                    normalizedPrompt
                );

            if (hasReadIntent && !params.context.getTool('google__gmail_read')) {
                const client = this.mcpRegistry?.getClient('google');
                if (client) {
                    const cachedOps = this.discoveryCache.get('google:gmail_discover') ?? [];
                    const readOp = cachedOps.find(
                        (op) => op.tool === 'gmail_read' || op.tool?.endsWith('_read')
                    );

                    if (readOp?.tool) {
                        const adapter = this.createMCPAdapter(client, 'google', readOp);
                        params.context.addTool(adapter);
                        addedTools.push(adapter.name);
                        this.logger.info(
                            `Planner incrementally added tool on replan: ${adapter.name}`
                        );
                    }
                }
            }
        }

        // Si ejecutó lectura de mensaje y el prompt requería descargar adjuntos
        if (
            params.lastToolName === 'google__gmail_read' &&
            params.lastResult?.success
        ) {
            const hasAttachmentIntent =
                /\b(adjunto|adjuntos|pdf|descargar|descarga|download|attachment)\b/i.test(
                    normalizedPrompt
                );

            if (
                hasAttachmentIntent &&
                !params.context.getTool('google__gmail_download_attachment')
            ) {
                const client = this.mcpRegistry?.getClient('google');
                if (client) {
                    const cachedOps = this.discoveryCache.get('google:gmail_discover') ?? [];
                    const attachOp = cachedOps.find((op) =>
                        (op.tool ?? '').includes('attachment')
                    );

                    if (attachOp?.tool) {
                        const adapter = this.createMCPAdapter(client, 'google', attachOp);
                        params.context.addTool(adapter);
                        addedTools.push(adapter.name);
                        this.logger.info(
                            `Planner incrementally added tool on replan: ${adapter.name}`
                        );
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
     * Resuelve dinámicamente una herramienta si el modelo la requiere durante el razonamiento.
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

    /**
     * Resuelve internamente las operaciones de un servicio específico mediante discovery único.
     */
    private async resolveServiceOperations(
        rule: ServiceRule,
        prompt: string,
        context: TaskToolContext
    ): Promise<string[]> {
        if (!this.mcpRegistry) {
            return [];
        }

        const client = this.mcpRegistry.getClient(rule.server);
        if (!client) {
            this.logger.warn(`MCP client for server "${rule.server}" not found.`);
            return [];
        }

        const serverTools = this.mcpRegistry.getTools(rule.server);
        const discoveryAdapter = serverTools.find((t) => {
            const name = t.name.toLowerCase();
            return name.includes(rule.discoveryToolPattern.toLowerCase());
        });

        if (!discoveryAdapter) {
            this.logger.warn(
                `Discovery adapter matching "${rule.discoveryToolPattern}" not found on server "${rule.server}".`
            );
            return [];
        }

        const cacheKey = `${rule.server}:${rule.discoveryToolPattern}`;
        let operations = this.discoveryCache.get(cacheKey);

        if (!operations) {
            this.logger.info(
                `Running internal MCP discovery via ${discoveryAdapter.name}`
            );

            const execContext: ToolExecutionContext = {
                workspaceRoot: '',
                requestApproval: async () => true,
            };

            // Importante: No enviar el prompt en lenguaje natural como filtro del query al MCP server.
            // Se consulta con cadena vacía para obtener el catálogo completo del servicio.
            const discResult = await discoveryAdapter.execute(
                { query: '' },
                execContext
            );

            if (discResult.success && discResult.data) {
                operations = this.parseDiscoveryPayload(discResult.data);
                this.discoveryCache.set(cacheKey, operations);
            } else {
                this.logger.warn(
                    `Discovery execution returned error: ${discResult.error}`
                );
                operations = [];
            }
        }

        this.logger.info(
            `Discovered ${operations.length} ${rule.displayName} operations`
        );

        if (operations.length === 0) {
            return [];
        }

        // Seleccionar la operación más relevante según la intención
        const selectedOps = this.selectOperationForService(
            rule.service,
            operations,
            prompt
        );

        const addedToolNames: string[] = [];

        for (const op of selectedOps) {
            if (!op.tool) continue;

            this.logger.info(`Selected operation: ${op.tool}`);

            const adapter = this.createMCPAdapter(client, rule.server, op);
            context.addTool(adapter);
            addedToolNames.push(adapter.name);
        }

        return addedToolNames;
    }

    /**
     * Selecciona la operación adecuada dentro del catálogo según la semántica de la solicitud.
     */
    private selectOperationForService(
        service: string,
        operations: DiscoveredOperation[],
        prompt: string
    ): DiscoveredOperation[] {
        const isSearchIntent =
            /\b(busca|buscar|busqueda|encontrar|encuentra|listar|lista|ultimos|ultimo|ultimas|search|find|list)\b/i.test(
                prompt
            );

        const isReadIntent =
            /\b(leer|lee|leerme|abrir|abre|contenido|cuerpo|read|body|open|ver)\b/i.test(
                prompt
            );

        const isWriteIntent =
            /\b(enviar|envia|mandar|manda|crear|crea|borrar|borra|eliminar|elimina|send|create|delete)\b/i.test(
                prompt
            );

        if (service === 'gmail') {
            // Prioridad 1: Búsqueda o listado
            if (isSearchIntent && !isWriteIntent) {
                const searchOp = operations.find(
                    (op) =>
                        op.tool === 'gmail_search' ||
                        op.tool === 'messages_search' ||
                        op.tool?.endsWith('_search')
                );
                if (searchOp) {
                    return [searchOp];
                }
            }

            // Prioridad 2: Lectura de correo específico
            if (isReadIntent && !isWriteIntent) {
                const readOp = operations.find(
                    (op) =>
                        op.tool === 'gmail_read' ||
                        op.tool === 'messages_get' ||
                        op.tool?.endsWith('_read')
                );
                if (readOp) {
                    return [readOp];
                }
            }

            // Prioridad 3: Envío o redacción
            if (isWriteIntent) {
                const sendOp = operations.find(
                    (op) =>
                        op.tool === 'gmail_send' ||
                        op.tool === 'messages_send' ||
                        op.tool?.endsWith('_send')
                );
                if (sendOp) {
                    return [sendOp];
                }
            }

            // Fallback predeterminado para Gmail: gmail_search
            const defaultSearch = operations.find((op) =>
                (op.tool ?? '').includes('search')
            );
            if (defaultSearch) {
                return [defaultSearch];
            }
        }

        if (service === 'calendar') {
            if (isWriteIntent) {
                const createOp = operations.find((op) =>
                    (op.tool ?? '').includes('create') || (op.tool ?? '').includes('insert')
                );
                if (createOp) return [createOp];
            }
            const listOp = operations.find((op) =>
                (op.tool ?? '').includes('list') || (op.tool ?? '').includes('get')
            );
            if (listOp) return [listOp];
        }

        if (service === 'drive') {
            if (isSearchIntent || isReadIntent) {
                const searchOp = operations.find((op) =>
                    (op.tool ?? '').includes('search') || (op.tool ?? '').includes('list')
                );
                if (searchOp) return [searchOp];
            }
        }

        return operations.slice(0, 1);
    }

    private createMCPAdapter(
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

    private detectMatchedServices(prompt: string): ServiceRule[] {
        const matched: ServiceRule[] = [];

        for (const rule of SERVICE_RULES) {
            if (rule.keywords.test(prompt)) {
                matched.push(rule);
            }
        }

        return matched;
    }

    private selectRelevantLocalTools(prompt: string): ITool[] {
        const tokens = this.tokenize(prompt);
        const localTools = this.tools
            .getAllTools()
            .filter((t) => !t.name.includes('__'));

        const scored = localTools
            .map((tool) => ({
                tool,
                score: this.scoreLocalTool(tool, prompt, tokens),
            }))
            .filter((item) => item.score >= 5)
            .sort((a, b) => b.score - a.score);

        return scored.slice(0, 3).map((item) => item.tool);
    }

    private scoreLocalTool(
        tool: ITool,
        _prompt: string,
        tokens: Set<string>
    ): number {
        const name = this.normalize(tool.name);
        const description = this.normalize(tool.description);
        const combined = `${name} ${description}`;
        let score = 0;

        for (const token of tokens) {
            if (token.length < 3) continue;
            if (name.includes(token)) score += 6;
            if (description.includes(token)) score += 2;
        }

        const aliases: Record<string, string[]> = {
            abrir: ['open', 'launch', 'application', 'app'],
            abre: ['open', 'launch', 'application', 'app'],
            calculadora: ['calculator', 'application'],
            volumen: ['volume', 'audio'],
            musica: ['media', 'music'],
            música: ['media', 'music'],
            portapapeles: ['clipboard'],
            archivo: ['file', 'read', 'write'],
            comando: ['command', 'execute', 'terminal'],
        };

        for (const token of tokens) {
            const aliasList = aliases[token];
            if (aliasList) {
                for (const alias of aliasList) {
                    if (combined.includes(alias)) {
                        score += 5;
                    }
                }
            }
        }

        return score;
    }

    private selectGenericFallback(prompt: string): ITool[] {
        if (
            /\b(busca|buscar|informacion|que es|quien es|noticias|web|internet)\b/i.test(
                prompt
            )
        ) {
            const webSearch = this.tools.getTool('web_search');
            if (webSearch) return [webSearch];
        }

        if (/\b(archivo|leer|lee|cat|texto)\b/i.test(prompt)) {
            const readFile = this.tools.getTool('read_file');
            if (readFile) return [readFile];
        }

        return [];
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

            if (Array.isArray(parsed)) {
                return parsed;
            }
            if (Array.isArray(parsed.operations)) {
                return parsed.operations;
            }
            if (Array.isArray(parsed.tools)) {
                return parsed.tools;
            }
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

    private tokenize(value: string): Set<string> {
        return new Set(
            value
                .split(/\s+/)
                .filter((token) => token.length >= 3)
        );
    }
}