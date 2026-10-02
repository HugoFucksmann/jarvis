import { ToolDefinition } from '../llm/types.js';
import { ITool, ToolExecutionContext, ToolResult } from './types.js';
import { ToolRegistry } from './ToolRegistry.js';
import { MCPRegistry } from '../mcp/MCPRegistry.js';
import { MCPToolAdapter } from '../mcp/MCPToolAdapter.js';
import { Logger } from '../logger/Logger.js';
import { ToolFunctionDefinition } from '../llm/types.js';

export class TaskToolContext {
    private tools = new Map<string, ITool>();
    private logger = new Logger('TaskToolContext');

    constructor(
        private readonly registry: ToolRegistry,
        private readonly mcpRegistry?: MCPRegistry
    ) { }

    public addTool(tool: ITool): void {
        this.tools.set(tool.name, tool);
    }

    public addToolByName(name: string): boolean {
        const tool = this.registry.getTool(name);

        if (!tool) {
            return false;
        }

        this.addTool(tool);
        return true;
    }

    public addToolsByName(names: string[]): void {
        for (const name of names) {
            this.addToolByName(name);
        }
    }

    public getDefinitions(): ToolDefinition[] {
        return Array.from(this.tools.values()).map((tool) =>
            tool.toDefinition()
        );
    }

    public getTool(name: string): ITool | undefined {
        return this.tools.get(name);
    }

    public getToolNames(): string[] {
        return Array.from(this.tools.keys());
    }

    public get size(): number {
        return this.tools.size;
    }

    public async executeTool(
        name: string,
        args: Record<string, unknown>,
        context: ToolExecutionContext
    ): Promise<ToolResult> {
        if (!this.tools.has(name)) {
            return {
                success: false,
                error: `Tool "${name}" is not available in the current task context.`,
            };
        }

        return this.registry.executeTool(
            name,
            args,
            context,
            this.tools
        );
    }

    /**
     * Adds MCP discovery tools relevant to the current task.
     */
    public addRelevantMCPTools(prompt: string): void {
        if (!this.mcpRegistry) {
            return;
        }

        const normalized = prompt.toLowerCase();

        for (const serverName of this.mcpRegistry.getServerNames()) {
            const serverTools =
                this.mcpRegistry.getTools(serverName);

            for (const tool of serverTools) {
                const name = tool.name.toLowerCase();
                const description =
                    tool.description.toLowerCase();

                const isDiscovery =
                    name.includes('discover') ||
                    description.includes('discover');

                if (!isDiscovery) {
                    continue;
                }

                if (
                    this.isMCPServerRelevant(
                        serverName,
                        normalized,
                        tool
                    )
                ) {
                    this.addTool(tool);

                    this.logger.debug(
                        `Added MCP discovery tool: ${tool.name}`
                    );
                }
            }
        }
    }

    /**
     * After a discovery call, add the concrete MCP tools returned by the
     * discovery result when their schemas are present.
     */
    public addDiscoveredMCPTools(
        serverName: string,
        result: ToolResult,
        prompt: string
    ): void {
        if (!result.success || !result.data) {
            return;
        }

        const client = this.mcpRegistry?.getClient(serverName);

        if (!client) {
            return;
        }

        try {
            const raw =
                typeof result.data === 'string'
                    ? result.data
                    : JSON.stringify(result.data);

            const parsed = JSON.parse(raw) as {
                service?: string;
                operations?: Array<{
                    tool?: string;
                    summary?: string;
                    args?: string[];
                    cud?: string;
                }>;
            };

            if (!Array.isArray(parsed.operations)) {
                return;
            }

            const normalizedPrompt = prompt
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '');

            const isSearchIntent =
                /\b(busca|buscar|busqueda|encontrar|encuentra|listar|lista|ultimos|ultimo|ultimas|mensajes|mails|mail|correo|correos|email|emails|search|find|list)\b/
                    .test(normalizedPrompt);

            const isReadIntent =
                /\b(leer|lee|leerme|contenido|cuerpo|mensaje|mensajes|read|body)\b/
                    .test(normalizedPrompt);

            const isWriteIntent =
                /\b(enviar|envia|mandar|manda|crear|crea|borrar|borra|eliminar|elimina|modificar|modifica|actualizar|actualiza|send|create|delete|update|modify)\b/
                    .test(normalizedPrompt);

            const scoredOperations = parsed.operations
                .filter((operation) => operation.tool)
                .map((operation) => {
                    const tool = operation.tool!.toLowerCase();
                    const summary = (operation.summary ?? '').toLowerCase();

                    let score = 0;

                    // Búsqueda/listado
                    if (
                        isSearchIntent &&
                        (
                            tool.includes('search') ||
                            /^gmail_.*_list$/.test(tool) ||
                            summary.includes('search messages') ||
                            summary.includes('search')
                        )
                    ) {
                        score += tool === 'gmail_search' ? 100 : 20;
                    }

                    // Lectura
                    if (
                        isReadIntent &&
                        (
                            tool.includes('read') ||
                            summary.includes('read')
                        )
                    ) {
                        score += tool === 'gmail_read' ? 100 : 20;
                    }

                    // Escritura
                    if (
                        isWriteIntent &&
                        (
                            tool.includes('send') ||
                            tool.includes('create') ||
                            tool.includes('update') ||
                            tool.includes('delete') ||
                            summary.includes('send') ||
                            summary.includes('create') ||
                            summary.includes('update') ||
                            summary.includes('delete')
                        )
                    ) {
                        score += 100;
                    }

                    // Coincidencia directa con palabras del prompt.
                    const words = normalizedPrompt
                        .split(/\s+/)
                        .filter((word) => word.length >= 4);

                    for (const word of words) {
                        if (tool.includes(word)) {
                            score += 5;
                        }

                        if (summary.includes(word)) {
                            score += 3;
                        }
                    }

                    // Para consultas de solo lectura, evitar operaciones CUD.
                    if (
                        !isWriteIntent &&
                        operation.cud &&
                        /create|update|delete/i.test(operation.cud)
                    ) {
                        score -= 50;
                    }

                    return {
                        operation,
                        score,
                    };
                })
                .filter((item) => item.score > 0)
                .sort((a, b) => b.score - a.score);

            // Para una intención clara de búsqueda, solamente necesitamos
            // la operación de búsqueda más relevante.
            let relevantOperations = scoredOperations;

            if (isSearchIntent && !isReadIntent && !isWriteIntent) {
                const searchOperation = scoredOperations.find(
                    ({ operation }) =>
                        operation.tool === 'gmail_search' ||
                        operation.tool?.endsWith('_search')
                );

                if (searchOperation) {
                    relevantOperations = [searchOperation];
                }
            }

            // Nunca enviar un catálogo enorme al LLM.
            relevantOperations = relevantOperations.slice(0, 5);

            for (const { operation } of relevantOperations) {
                if (!operation.tool) {
                    continue;
                }

                const fullName = serverName + '__' + operation.tool;

                if (this.tools.has(fullName)) {
                    continue;
                }

                const properties: Record<string, unknown> = {};

                for (const arg of operation.args ?? []) {
                    properties[arg] = {
                        type: 'string',
                        description: `Argumento ${arg}`,
                    };
                }

                const adapter = new MCPToolAdapter(client, {
                    name: operation.tool,
                    description:
                        operation.summary ?? `MCP tool ${operation.tool}`,
                    inputSchema: {
                        type: 'object',
                        properties,
                    },
                });

                this.addTool(adapter);

                this.logger.info(
                    `Added relevant discovered MCP tool: ${adapter.name}`
                );
            }

            this.logger.info(
                `MCP discovery filtered ${parsed.operations.length} operations to ${relevantOperations.length} relevant tools.`
            );
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);

            this.logger.error(
                `Failed to parse discovered MCP tools from "${serverName}": ${msg}`
            );
        }
    }

    /**
     * Makes relevant local tools available.
     *
     * MCP tools are excluded because they are handled separately.
     *
     * We use lexical relevance rather than hard-coded tool names so this
     * continues working when new local tools are added.
     */
    public addRelevantLocalTools(prompt: string): void {
        const normalized =
            this.normalize(prompt);

        const promptTokens =
            this.tokenize(normalized);

        const localTools =
            this.registry
                .getAllTools()
                .filter(
                    (tool) => !this.isMCPTool(tool.name)
                );

        const scored = localTools
            .map((tool) => ({
                tool,
                score: this.scoreTool(
                    tool,
                    normalized,
                    promptTokens
                ),
            }))
            .sort((a, b) => b.score - a.score);

        const positive = scored.filter(
            (item) => item.score > 0
        );

        if (positive.length > 0) {
            /*
             * Keep the context small, but don't artificially restrict it when
             * only a few tools are relevant.
             */
            const maxTools = Math.min(
                Math.max(8, positive.length),
                12
            );

            for (
                const item of positive.slice(
                    0,
                    maxTools
                )
            ) {
                this.addTool(item.tool);
            }
        }

        /*
         * If nothing matched, expose a small fallback set.
         *
         * This prevents JARVIS from becoming completely unusable for
         * natural-language requests that don't contain the exact tool name.
         */
        if (this.tools.size === 0) {
            const fallback = scored
                .slice(0, 8);

            for (const item of fallback) {
                this.addTool(item.tool);
            }
        }

        this.logger.info(
            `Local task tools selected: ${this.getToolNames().join(', ')}`
        );
    }

    private scoreTool(
        tool: ITool,
        prompt: string,
        promptTokens: Set<string>
    ): number {
        const name =
            this.normalize(tool.name);

        const description =
            this.normalize(tool.description);

        const combined =
            `${name} ${description}`;

        let score = 0;

        for (const token of promptTokens) {
            if (token.length < 3) {
                continue;
            }

            if (name.includes(token)) {
                score += 5;
            }

            if (description.includes(token)) {
                score += 2;
            }
        }

        /*
         * Common Spanish semantic aliases.
         * These do not depend on specific tool names.
         */
        const aliases: Record<string, string[]> = {
            abrir: [
                'open',
                'launch',
                'application',
                'app',
                'url',
                'browser',
            ],
            abre: [
                'open',
                'launch',
                'application',
                'app',
                'url',
                'browser',
            ],
            calculadora: [
                'calculator',
                'application',
                'app',
                'launch',
                'open',
            ],
            navegador: [
                'browser',
                'open',
                'url',
                'web',
            ],
            internet: [
                'web',
                'search',
                'browser',
                'url',
            ],
            busca: [
                'search',
                'web',
                'browser',
            ],
            buscar: [
                'search',
                'web',
                'browser',
            ],
            correo: [
                'gmail',
                'mail',
                'email',
            ],
            mail: [
                'gmail',
                'mail',
                'email',
            ],
            gmail: [
                'gmail',
                'mail',
                'email',
            ],
            volumen: [
                'volume',
                'audio',
            ],
            sonido: [
                'volume',
                'audio',
            ],
            musica: [
                'media',
                'music',
            ],
            música: [
                'media',
                'music',
            ],
            copiar: [
                'clipboard',
            ],
            pegar: [
                'clipboard',
            ],
            portapapeles: [
                'clipboard',
            ],
        };

        for (const token of promptTokens) {
            const aliasesForToken =
                aliases[token];

            if (!aliasesForToken) {
                continue;
            }

            for (
                const alias of aliasesForToken
            ) {
                if (combined.includes(alias)) {
                    score += 4;
                }
            }
        }

        return score;
    }

    private isMCPServerRelevant(
        serverName: string,
        prompt: string,
        tool: ITool
    ): boolean {
        const server =
            serverName.toLowerCase();

        const text =
            `${tool.name} ${tool.description}`.toLowerCase();

        /*
         * Google is a special case because the user usually says Gmail,
         * Drive or Calendar rather than "Google".
         */
        if (server === 'google') {
            const googleDomains = [
                'gmail',
                'mail',
                'email',
                'correo',
                'drive',
                'calendar',
                'calendario',
                'sheets',
                'docs',
                'contacts',
                'contactos',
                'meet',
                'tasks',
            ];

            return googleDomains.some(
                (word) =>
                    prompt.includes(word)
            );
        }

        return (
            prompt.includes(server) ||
            text
                .split(/\s+/)
                .some((word) =>
                    word.length >= 4 &&
                    prompt.includes(word)
                )
        );
    }

    private isMCPTool(
        name: string
    ): boolean {
        return name.includes('__');
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

    private tokenize(
        value: string
    ): Set<string> {
        return new Set(
            value
                .split(/\s+/)
                .filter(
                    (token) =>
                        token.length >= 3
                )
        );
    }

    private extractToolDefinitions(
        text: string
    ): Array<{
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
    }> {
        const parsed =
            this.extractJSON(text);

        const found: Array<{
            name: string;
            description?: string;
            inputSchema?: Record<string, unknown>;
        }> = [];

        const seen =
            new Set<string>();

        const visit = (
            value: unknown
        ): void => {
            if (!value || typeof value !== 'object') {
                return;
            }

            if (Array.isArray(value)) {
                for (const item of value) {
                    visit(item);
                }

                return;
            }

            const object =
                value as Record<string, unknown>;

            if (
                typeof object.name === 'string' &&
                (
                    object.inputSchema ||
                    object.parameters ||
                    object.schema
                )
            ) {
                const schema =
                    object.inputSchema ??
                    object.schema ??
                    object.parameters;

                if (
                    schema &&
                    typeof schema === 'object'
                ) {
                    const name =
                        object.name;

                    if (!seen.has(name)) {
                        seen.add(name);

                        found.push({
                            name,
                            description:
                                typeof object.description ===
                                    'string'
                                    ? object.description
                                    : undefined,
                            inputSchema:
                                schema as Record<
                                    string,
                                    unknown
                                >,
                        });
                    }
                }
            }

            for (
                const child of Object.values(object)
            ) {
                visit(child);
            }
        };

        for (const value of parsed) {
            visit(value);
        }

        return found;
    }

    private extractJSON(
        text: string
    ): unknown[] {
        const values: unknown[] = [];

        try {
            values.push(
                JSON.parse(text)
            );
        } catch {
            // Continue with embedded JSON extraction.
        }

        for (
            let start = 0;
            start < text.length;
            start++
        ) {
            if (
                text[start] !== '{' &&
                text[start] !== '['
            ) {
                continue;
            }

            const opening =
                text[start];

            const closing =
                opening === '{'
                    ? '}'
                    : ']';

            let depth = 0;
            let inString = false;
            let escaped = false;

            for (
                let i = start;
                i < text.length;
                i++
            ) {
                const char =
                    text[i];

                if (escaped) {
                    escaped = false;
                    continue;
                }

                if (
                    char === '\\' &&
                    inString
                ) {
                    escaped = true;
                    continue;
                }

                if (char === '"') {
                    inString =
                        !inString;
                    continue;
                }

                if (inString) {
                    continue;
                }

                if (
                    char === opening
                ) {
                    depth++;
                } else if (
                    char === closing
                ) {
                    depth--;

                    if (depth === 0) {
                        const fragment =
                            text.substring(
                                start,
                                i + 1
                            );

                        try {
                            values.push(
                                JSON.parse(fragment)
                            );
                        } catch {
                            // Ignore invalid fragment.
                        }

                        break;
                    }
                }
            }
        }

        return values;
    }
}