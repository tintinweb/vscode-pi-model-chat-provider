<p align="center">
  <img src="https://github.com/tintinweb/vscode-pi-model-chat-provider/raw/master/images/banner.png" alt="Pi Banner">
</p>

# Pi Coding Agent - Language Model Provider for VS Code

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/tintinweb.vscode-pi-model-chat-provider?style=flat-square&label=VS%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=tintinweb.vscode-pi-model-chat-provider)

VS Code Language Model Chat Provider integration for [Mario Zechner's](https://github.com/badlogic) open source [Pi coding agent](https://pi.dev), making Pi models available in VS Code's model picker for use with GitHub Copilot Chat and any extension that consumes the `vscode.lm.*` APIs.

<p align="center">
  <img src="https://github.com/tintinweb/vscode-pi-model-chat-provider/raw/master/images/demo.png" alt="Pi Banner">
</p>

https://github.com/user-attachments/assets/196cffa2-660e-4b7e-911b-389830420579

## Features

- **Universal Model Access**: Use Pi with any VS Code extension that supports language models
- **Dynamic Model Discovery**: Automatically detects all configured models from Pi, across every provider Pi supports (Anthropic, OpenAI, OpenRouter, and more)
- **Tool Execution**: Pi handles tools internally (file operations, bash commands, etc.)
- **Streaming Responses**: Real-time streaming of LLM responses
- **Tool Transparency**: Optional display of tool execution as text annotations

## Prerequisites

1. **Pi CLI** must be installed and available in your PATH:
   ```bash
   npm install -g @earendil-works/pi-coding-agent
   ```

2. **API Keys** configured via Pi:
   ```bash
   pi> /login
   ```

## Installation

1. Install the extension from the VS Code Marketplace (or build from source)
2. Verify Pi is installed: `pi --version`
3. Open VS Code and Pi models will appear in the model picker

## Configuration

Access settings via `Ctrl/Cmd+,` and search for "Pi":

| Setting | Description | Default |
|---------|-------------|---------|
| `pi.binaryPath` | Path to Pi CLI binary | `pi` |
| `pi.workingDirectory` | Working directory for Pi agent | Workspace root |
| `pi.autoRestart` | Auto-restart on crash | `true` |
| `pi.maxRestartAttempts` | Max restart attempts | `3` |
| `pi.additionalArgs` | Additional CLI arguments | `[]` |
| `pi.debug` | Enable debug logging | `false` |

## Usage

### With GitHub Copilot Chat

1. Open Copilot Chat (`Ctrl/Cmd+Shift+I`)
2. Click the model picker
3. Select a Pi model (e.g., `pi:anthropic:claude-sonnet-4-20250514`)
4. Start chatting!

### With Other Extensions

Any extension using `vscode.lm.*` APIs can use Pi models:

```typescript
const models = await vscode.lm.selectChatModels({ vendor: 'pi' });
const model = models[0];

const response = await model.sendRequest(messages, {}, token);
```

## Architecture

- **Process Isolation**: Pi runs in a separate process for stability
- **RPC Communication**: Uses Pi's RPC mode over stdin/stdout
- **Session Pooling**: Conversations are kept alive and reused across turns; idle sessions are cleaned up automatically
- **Tool Handling**: Pi executes tools internally

## Troubleshooting

### "Pi CLI not found"

Ensure Pi is installed and in your PATH:
```bash
which pi
# or
npm install -g @earendil-works/pi-coding-agent
```

### Check Logs

Open the Output panel (`Ctrl/Cmd+Shift+U`) and select "Pi Agent" from the dropdown to view logs.

### Enable Debug Logging

For detailed troubleshooting, enable debug mode:

1. Open Settings (`Ctrl/Cmd+,`)
2. Search for "Pi: Debug"
3. Check the box to enable

Or add to `settings.json`:
```json
{
  "pi.debug": true
}
```

## Development

```bash
# Clone and install
git clone <repo-url>
cd vscode-pi-model-chat-provider
npm install

# Compile
npm run compile

# Watch mode
npm run watch

# Package
npx @vscode/vsce package
```


## License

MIT

## Links

- [Pi Repository](https://github.com/badlogic/pi-mono)
- [VS Code Language Model API](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider)
