# 🤖 Plumar (plumar-cli) - Premium Agentic AI CLI Engine

An interactive, premium terminal-based AI Agent companion designed specifically for developers. Built in modern JavaScript (ESM) using the **Google Agent Development Kit (ADK)** and powered by local **Ollama**, Plumar dynamically discovers all models installed on your system—letting you select your preferred local LLM on startup or on-the-fly, and fully configure the active temperature, prompt profiles, and tool execution policies.

Plumar (also known as `plumar-cli`) comes fully equipped with a highly integrated suite of **35 safe workspace developer tools**, dynamic REPL slash commands, real-time reasoning observability, Model Context Protocol (MCP) support, custom extensible skills/plugins, automated tool-execution policy guards, prompt shell piping, persistent active session history, and an interactive synthetic audio arcade game.

> [!TIP]
> **New Documentation Hub**: We have created a comprehensive `docs/` folder with detailed guides on system architecture, all 35 tools, Model Context Protocol (MCP) servers, REPL slash commands, and the Plumar Dino Game. Read the [Documentation Index](file:///home/nandrade/localmodel/docs/README.md) to get started!

---

## ✨ Features & Capabilities

### 1. Interactive Terminal REPL
*   **Persistent Prompt History**: When a session is loaded or resumed, your command history is reloaded into readline so that **Up/Down arrows** and **`Ctrl+R`** work out of the box.
*   **Ctrl+R Interactive Reverse Search**: Press `Ctrl+R` while in the chat prompt to trigger an elegant, fuzzy interactive reverse search of your active and historical prompts.
*   **Vibrant CLI Aesthetics**: Colorful UI/UX themed using `picocolors`, custom block-text banners, and distinct tool call visualizations.
*   **Real-time Reasoning Logs**: Observable, dimmed, and italicized real-time logging of the model's `<thinking>` process before responses.
*   **Offline-First & Local**: Runs 100% locally with zero external API keys required.

### 2. Extensible Skills & Plugins
*   **Custom Agentic Skills**: Register YAML-like dynamic skills using `/add-skill` and `/skills` to extend the system prompts with specific agent capabilities.
*   **Custom JavaScript Plugins**: Author and load third-party tools as JavaScript plugins inside the `/plugins` directory with the `/add-plugin` command.

### 3. Fine-Grained Policy Security Guard
*   Configure fine-grained execution rules (`allow`, `ask`, `deny`) for individual tools on-the-fly using the `/policy` command or inline interactive prompts.
*   Policies are persisted to a JSON configuration file and loaded dynamically per session.

### 4. Dynamic Prompt Piping
*   Pipe natural language queries directly into shell commands using the `|` syntax. For example:
    `explain package.json | cat package.json | grep name`
*   Plumar parses the request, executes the LLM step, and forwards outputs to the shell command safely and instantly.

### 5. Context Compression & Minimization
*   Use the `/minimize` command to compress your session's token footprint using smart model-based content compression or metadata pruning, avoiding context window bloat.
*   Use the `/context` command to index your local directory tree, feeding an optimized workspace map directly into the agent's memory.

---

## 🛠️ Complete Workspace Tools Reference

Plumar features **35 schema-validated workspace, diagnostic, and media tools**:

### 📁 Safe Workspace Filesystem
| Tool Name | Description | Key Parameters |
| :--- | :--- | :--- |
| **`listFiles`** | Recursively maps workspace directory tree structure, ignoring dependency noise. | `directory` |
| **`readFile`** | Reads plain-text files with automatic 10,000-character safety truncation. | `filePath` |
| **`writeFile`** | Safely writes and overwrites workspace plain-text files with automatic parent directory creation. | `filePath`, `content` |
| **`appendFile`** | Appends plain text content to the end of a file (creates if missing). | `filePath`, `content` |
| **`deleteFile`** | Safely removes a file from the workspace filesystem. | `filePath` |
| **`makeDirectory`** | Recursively creates new subdirectories inside the workspace boundaries. | `directoryPath` |
| **`writeMarkdown`** | Generates highly structured Markdown files with headings, section blocks, and titles. | `filePath`, `title`, `sections` |

### 💻 Development & System Operations
| Tool Name | Description | Key Parameters |
| :--- | :--- | :--- |
| **`executeCommand`** | Safely executes terminal commands in the workspace with process timeouts. | `command` |
| **`searchReplace`** | Finds and replaces a specific exact text block inside a file. | `filePath`, `findText`, `replaceText` |
| **`searchGrep`** | Runs ripgrep-like search or Regex matching across files in the workspace. | `query`, `directory`, `isRegex` |
| **`findFiles`** | Recursively finds files matching glob/wildcard patterns (e.g., `*.json`). | `pattern`, `directory` |
| **`portManager`** | Query active processes on network ports, or terminate a process by port/PID to resolve blocks. | `action`, `port`, `pid` |
| **`regexHelper`** | Evaluates, matches, or replaces text strings using high-performance regular expressions. | `action`, `pattern`, `flags`, `text` |
| **`codeFormatter`** | Formats or lints files in-place using project ESLint or Prettier configurations. | `filePath`, `action` |
| **`dependencyScanner`**| Scans imports and `package.json` to detect unused/undeclared node dependencies or audits. | `action` |
| **`gitHelper`** | Retrieves repository status, logs, diffs, and drafts intelligent commits based on staged files. | `action` |
| **`dbExplorer`** | Inspects schema details and runs zero-dependency custom queries on PostgreSQL/MySQL databases. | `connectionUri`, `action`, `sql` |

### 🌐 Network, API & Load Testing
| Tool Name | Description | Key Parameters |
| :--- | :--- | :--- |
| **`fetchWebPage`** | Fetches textual content of public web URLs or REST APIs with HTML stripping and timeouts. | `url` |
| **`fetchImage`** | Downloads remote images securely into the workspace with Content-Type checks. | `url`, `outputPath` |
| **`restClient`** | Executes custom HTTP API requests (GET, POST, etc.) with custom headers and body. | `url`, `method`, `headers`, `body` |
| **`apiPerformanceTest`**| Executes load and concurrent latency tests on any API endpoint, compiling latencies. | `url`, `method`, `requests` |

### 📊 Data, Encryption & Media
| Tool Name | Description | Key Parameters |
| :--- | :--- | :--- |
| **`base64Convert`** | Encodes text/files to base64 or decodes base64 strings back to text/files. | `action`, `input` |
| **`generateMockData`** | Generates customized realistic mock datasets (JSON, CSV, SQL, etc.) based on instructions. | `instructions`, `format` |
| **`generateHash`** | Computes cryptographic hashes (MD5, SHA-1, SHA-256) of strings or files. | `action`, `input` |
| **`generateImage` (ALPHA)** | Procedurally draws and generates custom images (PNG/JPEG) offline using a local shape canvas. | `outputPath`, `prompt`, `width` |
| **`generateVideo` (ALPHA)** | Generates custom video files using Google GenAI (Veo) model (with local fallback). | `outputPath`, `prompt` |

### 🧠 Custom Skills, Plugins & Fun
| Tool Name | Description | Key Parameters |
| :--- | :--- | :--- |
| **`listSkills`** | Lists all custom registered agentic skills currently loaded in the system. | *(none)* |
| **`loadSkill`** | Dynamically loads and appends a specific custom agentic skill's system instructions. | `skillName` |
| **`createSkill`** | Generates and registers a new dynamic agentic skill inside the `/skills` directory. | `name`, `instructions` |
| **`createPlugin`** | Generates a standard ESM JavaScript code plugin template inside the `/plugins` directory. | `fileName`, `toolName` |
| **`calculator`** | Safely evaluates standard math expressions. Rejects arbitrary JS injections. | `expression` |
| **`getSystemInfo`** | Retrieves local system diagnostics (OS platform, CPU cores, uptime, RAM). | *(none)* |
| **`getCurrentTime`** | Returns local date, timestamp, and timezone offset of the host machine. | *(none)* |
| **`createAsciiArt`** | Generates block/slant ASCII art from text, custom preset shapes, or loaded images. | `text`, `font`, `presetShape` |
| **`dinoGame`** | Spins up a local Node.js server and launches the rebranded **plumar-cli Dino** game in the default browser. | `action` |

---

## 👾 The plumar-cli Dino Game

A fully custom, high-fidelity browser game was designed and placed inside `dino-game/index.html`. It runs with pure client-side HTML, CSS, and Javascript.

### 🌟 Game Features:
*   **Deep Space Aesthetics**: Vibrant retro-neon color schemes with a glowing geometric T-Rex, scrolling procedural floors, and twinkling parallax-star backdrops.
*   **Synthesized Audio FX**: Powered entirely by the **Web Audio API** (requires no external audio files). Generates nostalgic 8-bit sound waves for jumps, gravity flips, milestone high scores, and crashes.
*   **Gravity Physics Modes**:
    1.  **Standard Gravity**: Classic Chrome Dino jumping and ducking.
    2.  **Low Gravity**: Smooth low-G gliding physics.
    3.  **Gravity Flip Mode**: Dino can run on the ceiling! Flip gravity upside-down on-the-fly.
*   **Score & Stats Tracker**: Tracks real-time score, increases game speed as score rises, and saves high scores persistently to the browser's `localStorage` (keyed under `plumar_cli_high_score`).

### 🎮 Game Controls:
*   **Jump / Glide Up**: `Space` or `↑ Arrow` (or click/tap on the screen)
*   **Duck / Slam Down**: `↓ Arrow`
*   **Flip Gravity**: `Shift` or `F`

---

## 🛠️ Reorganized Project Architecture

The codebase has been refactored and organized to keep the root directory pristine and modular:

```
/home/nandrade/localmodel/
├── index.js                  # Main terminal entry-point & CLI interactive loop (root)
├── src/                      # Core application source folder
│   ├── agent.js              # ADK model provider & manual turn-by-turn agent loop
│   ├── formatter.js          # Visual themes, banners, and CLI layout utilities
│   ├── google-search-mcp.js  # Built-in Google search MCP server
│   ├── mcp-client-manager.js # Connections manager for external MCP servers
│   ├── mcp.js                # Local MCP server wrapper
│   ├── reverse-search.js     # Ctrl+R reverse search handler
│   ├── session-manager.js    # Persistent file sessions service & dashboard
│   ├── skills-plugins-manager.js # Extensible skills/plugins coordinator
│   └── tools.js              # Safe schema-validated workspace and system tools (Zod)
├── dino-game/                # Rebranded plumar-cli Dino web game assets
├── docs/                     # Comprehensive system documentation
├── plugins/                  # User custom JavaScript tools plugins
├── skills/                   # User custom YAML-like agentic skills
├── tests/                    # Robust unit and integration test suite
├── package.json              # Dependency definitions & scripts
└── mcp-servers.json          # External MCP server configurations
```

---

## 🚀 Quick Start

### 1. Prerequisites
Ensure you have **Node.js** (v22+) and **Ollama** installed on your host machine.

### 2. Pull Your Preferred Local Model
Make sure your local Ollama instance is active and has your preferred LLM pulled (e.g., `gemma4`, `llama3`, `qwen2.5`, etc.). On startup, Plumar automatically discovers all installed tags and presents an interactive menu to let you choose:
```bash
ollama pull gemma4
```

### 3. Installation

You can install and run Plumar either locally within the project folder or globally on your system to run it from any location.

#### Option A: Local Installation
Install the project dependencies (done in the workspace root):
```bash
npm install
```

#### Option B: Global Installation (Use from Any Location) 🌟
You can deploy `plumar-cli` globally on your machine using the built-in global deployment script. This allows you to run `plumar` or `plumar-cli` commands from any directory!

1. Make sure you are in the project root directory.
2. Run the global deployment script:
   ```bash
   ./deploy-global.sh
   ```
   This script will verify your prerequisites and guide you through the interactive options:
   * **Development Link (`npm link`)**: Symlinks this directory globally (perfect for local development/modifications).
   * **Clean Global Install (`npm install -g .`)**: Installs a copy of the current folder directly to your global node modules.
   * **Distribution Tarball (`npm pack`)**: Packs and installs a clean tarball globally.

   You can also run the deployment script directly in non-interactive mode using flags:
   ```bash
   ./deploy-global.sh --global     # Standard global installation
   ./deploy-global.sh --link       # Symlink for local development
   ./deploy-global.sh --pack       # Create tarball and install
   ./deploy-global.sh --uninstall  # Uninstall global deployment
   ```

3. Once installed, verify the installation and start Plumar from any directory using:
   ```bash
   plumar
   ```
   *(or `plumar-cli`)*

#### Option C: Direct Installation from GitHub 🌐

If you don't have the source code cloned locally and want a seamless, fully-automated one-step installation straight from the official repository, you can run the direct installer script.

##### 1. Bash One-Liner (Recommended)
This script will clone/update the Plumar repository to your home directory (`~/.plumar`), install all dependencies, and deploy the global commands:
```bash
curl -fsSL https://raw.githubusercontent.com/nuno-joao-andrade-dev/plumar/main/install.sh | bash
```

*Or, if you prefer `wget`:*
```bash
wget -qO- https://raw.githubusercontent.com/nuno-joao-andrade-dev/plumar/main/install.sh | bash
```

##### 2. Direct NPM Install (Alternative)
Alternatively, you can install the package globally straight from the repository link using `npm`:
```bash
npm install -g https://github.com/nuno-joao-andrade-dev/plumar
```

Once complete, start the application from any folder on your machine:
```bash
plumar
```

### 4. Run the Chat Application
If you opted for local installation, start the interactive CLI session from the workspace root:
```bash
npm start
```

---

## 🎛️ Terminal Slash Commands

While in the interactive prompt, you can use special commands to manage your session:

| Slash Command | Action / Behavior |
| :--- | :--- |
| **`/help [cmd]`** | Show instructions and available commands. |
| **`/features`** | Show a premium overview of major system and developer features. |
| **`/mode`** | Switch between prompt profiles (`balanced`, `code`, `system`, `creative`). |
| **`/model`** | Change the active local LLM model on-the-fly. |
| **`/host`** | View or change the active Ollama base API host URL (local or remote). |
| **`/tools`** | List all workspace and system tools currently equipped. |
| **`/samples`** | Show sample prompts and arguments for every tool. |
| **`/skills`** | List all loaded custom agentic skills. |
| **`/add-skill`** | Open interactive wizard to create and register a custom skill. |
| **`/plugins`** | List all loaded custom JavaScript code plugins. |
| **`/add-plugin`** | Open interactive wizard to create and register a custom JS plugin. |
| **`/sessions`** | Manage, load, or delete active and stored conversation sessions. |
| **`/history`** | Show prompt history sequentially. |
| **`/info`** | Display active session diagnostics. Add `json` to output as raw JSON. |
| **`/verbose`** | Toggle verbose JSON payload logging (disabled by default). |
| **`/adk-info`** | Toggle ADK internal info logging (disabled by default). |
| **`/policy`** | Configure fine-grained allow/ask/deny execution rules for tools on-the-fly. |
| **`/settings`** | View or dynamically switch settings (Ollama endpoint, authentication tokens/headers, tool policies, logs). |
| **`/clear`** | Clear the terminal screen and reset active conversation history. |
| **`/minimize`** | Perform smart metadata pruning or model-based compression of the session's context. |
| **`/context [dir]`**| Scan and index workspace directories recursively, appending the map to the active session. |
| **`/exit` or `/quit`**| Safely terminate the chat session. |

### 🎭 Customizing Chat Modes

You can customize the prompt profiles or define your own chat modes locally:
1. Open the settings file at `./.plumar/settings.json` (created automatically on first run).
2. Edit or add keys inside the `"chatModes"` mapping.
3. Each chat mode should have the following structure:
   ```json
   "my-mode": {
     "name": "My Custom Mode",
     "emoji": "🌟",
     "description": "Your custom mode description",
     "temperature": 0.7,
     "systemPrompt": "You are a custom assistant..."
   }
   ```
4. Restart the application or run `/mode` to switch to your custom mode!

---

## 🔌 Configuring External MCP Servers

You can configure external **Model Context Protocol (MCP)** servers to dynamically expand the agent's toolset. 

On startup, the CLI automatically loads server definitions from `mcp-servers.json` in the workspace root, spawns their processes, handles JSON-RPC handshakes, and registers their tools with unique namespacing.

### Adding an MCP Server

1. Open or create **`mcp-servers.json`** in your workspace root.
2. Define your server under the `"mcpServers"` object.
3. Configure the commands, arguments, and custom environments.

#### **Configuration Format:**
```json
{
  "mcpServers": {
    "sqlite": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-sqlite",
        "--db",
        "sqlite.db"
      ],
      "disabled": false
    },
    "custom-python-server": {
      "command": "python",
      "args": ["src/server.py"],
      "env": {
        "API_SECRET_KEY": "my_secret_token"
      }
    }
  }
}
```

When you restart the CLI application, the new tools will automatically be available in the active session under prefixed names, such as `sqlite_query`!

---

## 🔒 Security Sandboxing (`resolveSafePath`)

To prevent path traversal and arbitrary host system files editing, plumar-cli enforces rigid scoping rules:
* Every filesystem operation resolves relative paths and fully sanitizes absolute paths using `resolveSafePath()`.
* If a resolved path falls outside the current working directory (`process.cwd()`), the execution is immediately aborted with a safety warning: `Access denied: Action not permitted outside workspace directory.`

---

## 🧪 Running Tests

The application includes a highly thorough unit and integration test suite targeting the AI agent model loops, sessions service, readline history restoration, dynamic piping, and tools sandboxing.

You can run individual test files natively:
```bash
node --test tests/tools.test.js
node --test tests/sessions.test.js
node --test tests/agent.test.js
node --test tests/history-pipes.test.js
node --test tests/google-search-mcp.test.js
node --test tests/skills-plugins.test.js
```
