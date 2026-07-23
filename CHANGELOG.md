# Change Log

All notable changes to the "vscode-pi-model-chat-provider" extension will be documented in this file.

## [0.2.1] - 2026-07-23

### Fixed
- OpenRouter (and any provider whose model IDs contain a slash, e.g.
  `openrouter:anthropic/claude-3.5-sonnet`) no longer fails with
  `Unknown model … not registered by the Pi provider`. The vendor-prefix
  stripping now removes only a literal leading `pi/` instead of splitting on
  arbitrary slashes, so the lookup key matches the one used at registration.
  Thanks to @DeluxeOwl (#4).

## [0.2.0] - 2026-05-14

### Fixed
- "Sorry, no response was returned" — fixed several root causes:
  - Messages without a literal `<user_query>` tag were silently dropped; the
    full message text is now always forwarded to Pi.
  - Response text is now fetched via the `get_last_assistant_text` RPC command
    instead of being reconstructed from streamed content blocks. This is
    model-agnostic and works regardless of how a model (codex, reasoning, etc.)
    structures its output.
- The agent no longer hangs on `extension_ui_request` dialogs. `confirm`
  requests are surfaced as a real modal Allow/Deny dialog; the rest are
  answered or treated as fire-and-forget per the RPC protocol.
- Pi agent errors (e.g. an unsupported model) are now surfaced in the chat
  instead of a bare "no response returned".
- Requesting a tool call no longer causes an infinite loop. Tool activity is
  rendered as text instead of `LanguageModelToolCallPart`, which VS Code
  treated as a call it had to fulfill — re-invoking the provider repeatedly.

### Changed
- Migrated to the renamed `@earendil-works/pi-coding-agent` package.
- Each conversation turn is sent to Pi as a single combined prompt instead of
  replaying messages individually.
- Model list is cached for 30 seconds (was cached indefinitely), so models Pi
  gains or loses appear without a window reload.
- All logging now goes to a single shared "Pi Agent" output channel; the
  always-on trace shows event types, and full event payloads are logged when
  `pi.debug` is enabled.
- Performance: the model is only re-set on the Pi process when it actually
  changes, and the status bar refresh no longer blocks turn completion.

## [0.1.0] - 2026-02-12

### Added
- Initial release
- Language Model Chat Provider integration for Pi coding agent
- Multi-turn conversation persistence with session pooling
- Support for up to 20 concurrent chat sessions
- LRU eviction and idle timeout cleanup (10 minutes)
- Status bar showing context window utilization
- Dynamic model enumeration from Pi
- Streaming responses with tool execution display
- Cancellation support (stop button)
- Automatic context (environment, workspace) injection

### Features
- Session isolation per chat thread
- Context window tracking and display
- Graceful error handling for empty/image-only messages
- Model caching for fast startup
- Persistent metadata bridge for quick model enumeration
- Debug logging configurable via settings (disabled by default)

### Configuration
- `pi.binaryPath` - Path to Pi CLI binary
- `pi.workingDirectory` - Working directory for Pi agent
- `pi.autoRestart` - Auto-restart on crash
- `pi.maxRestartAttempts` - Max restart attempts
- `pi.additionalArgs` - Additional CLI arguments
- `pi.debug` - Enable debug logging (default: false)
