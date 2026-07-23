/**
 * Pi Chat Provider - VS Code Language Model Chat Provider implementation
 */

import * as vscode from 'vscode';
import type { SessionPool } from './session-pool.js';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import { debug } from './debug.js';

export class PiChatProvider implements vscode.LanguageModelChatProvider {
    // Store mapping of model ID -> provider for lookup
    private modelProviderMap = new Map<string, string>();

    constructor(
        private pool: SessionPool
    ) {}

    /**
     * Provide information about available models
     */
    async provideLanguageModelChatInformation(
        _options: vscode.PrepareLanguageModelChatModelOptions,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelChatInformation[]> {
        try {
            // Get models from a temporary bridge (just to query available models)
            // We don't use the pool here since this is just querying capabilities
            const models = await this.pool.getAvailableModels();
            
            // Safety check
            if (!models || !Array.isArray(models)) {
                console.error('getAvailableModels returned invalid data:', models);
                return [];
            }

            return models.map((model: { id: string; provider: string; contextWindow: number; maxTokens: number }) => {
                // Use colon separator to avoid conflicts with dashes in provider names
                // Format: "provider:model-id" (e.g., "github-copilot:grok-code-fast-1")
                const modelId = `${model.provider}:${model.id}`;
                
                // Store provider mapping for later lookup
                this.modelProviderMap.set(modelId, model.provider);
                
                // Extract family name (e.g., "claude-sonnet-4-20250514" -> "claude-sonnet-4")
                const family = model.id.split('-').slice(0, -1).join('-') || model.id;

                const modelInfo = {
                    id: modelId,
                    name: `pi /${model.provider}/${model.id}`,
                    family,
                    version: model.id,
                    maxInputTokens: model.contextWindow,
                    maxOutputTokens: model.maxTokens || 16384, // Use model's maxTokens, fallback to 16384
                    tooltip: 'Pi Coding Agent with tool-calling capabilities',
                    detail: `Autonomous agent using ${model.provider} models`,
                    capabilities: {
                        toolCalling: true  // Pi supports tool execution (bash, file ops, etc.)
                    }
                } satisfies vscode.LanguageModelChatInformation;

                debug('[Pi Provider] Registering model:', { id: modelId, provider: model.provider, modelId: model.id });
                return modelInfo;
            });
        } catch (error) {
            // Return empty array on error - VS Code will handle gracefully
            console.error('Failed to get Pi models:', error);
            return [];
        }
    }

    /**
     * Provide streaming chat response
     */
    async provideLanguageModelChatResponse(
        model: vscode.LanguageModelChatInformation,
        messages: readonly vscode.LanguageModelChatRequestMessage[],
        _options: vscode.ProvideLanguageModelChatResponseOptions,
        progress: vscode.Progress<vscode.LanguageModelResponsePart>,
        token: vscode.CancellationToken
    ): Promise<void> {
        // Debug logging
        debug('[Pi Provider] ========================================');
        debug('[Pi Provider] Received request for model:', {
            id: model.id,
            name: model.name,
            family: model.family,
            vendor: (model as any).vendor  // Check if vendor property exists
        });
        
        // Parse the model ID flexibly
        // VS Code may send: "pi/provider:model-id" or just "provider:model-id"
        let modelId = model.id;
        
        // Only strip a literal leading "pi/" vendor prefix. Do NOT split on
        // arbitrary slashes: OpenRouter model IDs (e.g.
        // "openrouter:anthropic/claude-3.5-sonnet") legitimately contain
        // slashes, and the old split('/') logic mangled them, producing
        // "Unknown model / not registered by the Pi provider" errors.
        if (modelId.startsWith('pi/')) {
            modelId = modelId.slice(3);
            debug('[Pi Provider] Stripped pi/ vendor prefix, model ID:', modelId);
        }
        
        // Look up provider from our map (we stored it during registration)
        const provider = this.modelProviderMap.get(modelId);
        if (!provider) {
            console.error('[Pi Provider] Model ID not found in map:', modelId);
            console.error('[Pi Provider] Available models:', Array.from(this.modelProviderMap.keys()));
            throw new Error(
                `Unknown model: "${modelId}". ` +
                `This model was not registered by the Pi provider. ` +
                `Available Pi models: ${Array.from(this.modelProviderMap.keys()).join(', ')}`
            );
        }
        
        // Extract the actual model ID (after the colon)
        const colonIndex = modelId.indexOf(':');
        if (colonIndex === -1) {
            console.error('[Pi Provider] Model ID has no colon separator:', modelId);
            throw new Error(`Invalid model ID format: "${modelId}". Expected "provider:model-id".`);
        }
        
        const parsedModel = {
            provider: provider,
            modelId: modelId.substring(colonIndex + 1)
        };
        debug('[Pi Provider] Parsed model:', parsedModel);

        // Get or create session for this conversation
        let result;
        try {
            result = await this.pool.getOrCreate(messages, modelId);
        } catch (error) {
            // Handle context-only messages (no user query) gracefully
            if (error instanceof Error && error.message.includes('No messages with text content')) {
                debug('[Pi Provider] Message batch had no text content - skipping');
                return; // Silently skip - VS Code will send the actual query in next call
            }
            throw error;
        }
        
        const { bridge, isNew, newPrompt } = result;

        debug('[Pi Provider] Session state:', { isNew, promptLength: newPrompt.length });

        // Event handler for streaming (stateful per request)
        const handler = this.createEventHandler(progress);

        try {
            if (token.isCancellationRequested) {
                debug('[Pi Provider] Cancellation requested before send');
                return;
            }

            debug('[Pi Provider] Sending prompt to Pi:', {
                length: newPrompt.length,
                preview: newPrompt.substring(0, 200)
            });

            await bridge.sendPrompt({
                prompt: newPrompt,
                model: parsedModel,
                onEvent: handler.onEvent,
                token
            });

            if (token.isCancellationRequested) {
                return;
            }

            // Pi's RPC mode does not stream text deltas, so fetch the completed
            // answer once the agent is done. `get_last_assistant_text` is
            // model-agnostic - it works regardless of how a model structures
            // its content blocks.
            if (!handler.state.streamedText) {
                const text = await bridge.getLastAssistantText();
                if (text) {
                    progress.report(new vscode.LanguageModelTextPart(text));
                } else if (!handler.state.reportedToolActivity) {
                    // Nothing came back at all - surface why, instead of
                    // letting VS Code show a bare "no response returned".
                    throw new Error(
                        handler.state.agentError
                            ? `Pi agent error: ${handler.state.agentError}`
                            : 'Pi agent finished without producing any response. ' +
                              'Check the "Pi Agent" output channel for details.'
                    );
                }
            }

            // Refresh the status bar in the background. The response is already
            // fully reported, so don't make VS Code wait on these extra RPC
            // round-trips before the turn is considered complete.
            void this.pool.updateStatusBar(bridge);
        } catch (error) {
            // Check if error is due to cancellation
            if (error instanceof Error && error.message.includes('cancelled')) {
                debug('[Pi Provider] Request cancelled by user');
                return; // Gracefully exit without throwing
            }
            // Re-throw other errors
            throw error;
        }
    }

    /**
     * Provide token count estimation
     */
    async provideTokenCount(
        _model: vscode.LanguageModelChatInformation,
        text: string | vscode.LanguageModelChatRequestMessage,
        _token: vscode.CancellationToken
    ): Promise<number> {
        const content = typeof text === 'string' 
            ? text 
            : this.extractTextFromMessage(text);

        // Heuristic: ~4 characters per token
        return Math.ceil(content.length / 4);
    }

    /**
     * Build a stateful event handler for a single request.
     *
     * Pi's RPC mode emits `message_start` / `message_end` but not incremental
     * `message_update` / `text_delta` events, so the response text is fetched
     * after completion via `get_last_assistant_text` (see the caller) rather
     * than reconstructed from events here. This handler forwards live tool
     * activity, streams deltas if a future Pi version emits them, and records
     * any agent-side error so the caller can surface it.
     */
    private createEventHandler(
        progress: vscode.Progress<vscode.LanguageModelResponsePart>
    ): {
        onEvent: (event: AgentEvent) => void;
        state: { streamedText: boolean; reportedToolActivity: boolean; agentError?: string };
    } {
        const state: {
            streamedText: boolean;
            reportedToolActivity: boolean;
            agentError?: string;
        } = { streamedText: false, reportedToolActivity: false };

        const onEvent = (event: AgentEvent): void => {
            debug('[Pi Provider] Event received:', event.type);

            // Incremental streaming - only if a future Pi version emits it.
            if (event.type === 'message_update') {
                const { assistantMessageEvent } = event;
                if (assistantMessageEvent.type === 'text_delta') {
                    state.streamedText = true;
                    progress.report(
                        new vscode.LanguageModelTextPart(assistantMessageEvent.delta)
                    );
                }
            }

            // Record any agent-side error so the caller can surface it.
            if (event.type === 'message_end') {
                debug('[Pi Provider] message_end:', event.message);
                const error = this.extractErrorMessage(event.message);
                if (error) {
                    state.agentError = error;
                }
            }

            // Pi executes its tools internally, so render tool activity as
            // plain text. Do NOT emit LanguageModelToolCallPart: VS Code treats
            // that as a tool call IT must fulfill, then re-invokes the provider
            // to "continue" - which makes Pi rerun the whole turn in a loop.
            if (event.type === 'tool_execution_start') {
                debug('[Pi Provider] Tool execution start:', event.toolName);
                state.reportedToolActivity = true;
                const args = event.args && Object.keys(event.args).length > 0
                    ? ' ' + JSON.stringify(event.args)
                    : '';
                progress.report(new vscode.LanguageModelTextPart(
                    this.fenceBlock(`[${event.toolName}]${args}`)
                ));
            }

            if (event.type === 'tool_execution_end') {
                debug('[Pi Provider] Tool execution end:', event.toolName, event.isError ? 'error' : 'success');

                if (event.result?.content && Array.isArray(event.result.content)) {
                    const resultText = event.result.content
                        .filter((c: any) => c.type === 'text')
                        .map((c: any) => c.text)
                        .join('\n');

                    if (resultText) {
                        state.reportedToolActivity = true;
                        progress.report(new vscode.LanguageModelTextPart(
                            this.fenceBlock(resultText)
                        ));
                    }
                }
            }
        };

        return { onEvent, state };
    }

    /**
     * Wrap arbitrary text in a Markdown code fence. The fence is made longer
     * than the longest backtick run in the content, so tool output or args
     * that themselves contain ``` cannot break out of the block and inject
     * Markdown/HTML into the chat view.
     */
    private fenceBlock(text: string): string {
        const longestRun = (text.match(/`+/g) ?? [])
            .reduce((max, run) => Math.max(max, run.length), 0);
        const fence = '`'.repeat(Math.max(3, longestRun + 1));
        return `\n${fence}\n${text}\n${fence}\n`;
    }

    /**
     * If an assistant message ended in an error or abort, return its error
     * text (or the stop reason) so it can be surfaced to the user.
     */
    private extractErrorMessage(message: unknown): string | undefined {
        const msg = message as { role?: string; stopReason?: string; errorMessage?: string };
        if (msg && msg.role === 'assistant' && (msg.stopReason === 'error' || msg.stopReason === 'aborted')) {
            return msg.errorMessage || `stopReason: ${msg.stopReason}`;
        }
        return undefined;
    }

    /**
     * Extract text from a chat message
     */
    private extractTextFromMessage(message: vscode.LanguageModelChatRequestMessage): string {
        const textParts: string[] = [];
        
        for (const part of message.content) {
            if (part instanceof vscode.LanguageModelTextPart) {
                textParts.push(part.value);
            }
        }

        return textParts.join('\n');
    }
}
