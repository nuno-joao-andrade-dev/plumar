# 🎛️ Terminal Slash Commands

While in an active **plumar-cli Agent Chat** (Plumar) prompt, you can use specialized slash commands (`/`) to interact with the environment, modify active variables, configure endpoints/authentication, switch models, manage conversation history, or build new custom skills.

This document serves as a complete, comprehensive reference for all **22 available terminal slash commands**.

---

## 📋 Commands Quick Reference

| Slash Command | Short Parameter | Output / Action |
| :--- | :--- | :--- |
| **`/help [cmd]`** | `[cmd]` *(optional)* | Displays general usage instructions or detailed help for a specific command. |
| **`/features`** | None | Displays a premium, stylized visual summary of major system features. |
| **`/mode [name]`** | `[name]` *(optional)* | View active conversation profile, or switch to `balanced`, `code`, `system`, or `creative`. |
| **`/model [name]`**| `[name]` *(optional)* | View or change active local model. Interactively swaps models on-the-fly. |
| **`/host [url]`** | `[url]` *(optional)* | View or change the active Ollama API server base URL endpoint. |
| **`/settings`** | `[args]` *(optional)* | Interactive control panel for endpoints, authentication, policies, and logs. |
| **`/tools`** | None | Lists names, states, and descriptions of all 35 local and MCP-loaded tools. |
| **`/samples`** | None | Prints highly detailed usage prompts and arguments for every single tool. |
| **`/skills`** | None | Lists all custom agentic YAML skills currently registered and loaded. |
| **`/add-skill`** | None | Triggers an interactive step-by-step wizard to author and register a new skill. |
| **`/plugins`** | None | Lists all third-party custom JavaScript tools and plugins loaded in the system. |
| **`/add-plugin`** | None | Triggers an interactive step-by-step wizard to template and register a JS plugin. |
| **`/sessions`** | `[args]` *(optional)* | Lists, loads, resumes, deletes, or renames active or persistent chat sessions. |
| **`/history`** | None | Outputs your entire terminal prompt history sequentially. |
| **`/clear`** | None | Clears your terminal console screen and flushes conversation memory. |
| **`/info [json]`** | `json` *(optional)* | Displays diagnostics (model, host, session length) as YAML or raw JSON. |
| **`/verbose`** | None | Toggles verbose logging of raw JSON payload prompts and completions. |
| **`/adk-info`** | None | Toggles internal telemetry and logging outputs from `@google/adk`. |
| **`/policy`** | `[args]` *(optional)* | View, persist, or configure fine-grained tool execute rules (`allow`, `ask`, `deny`). |
| **`/minimize`** | None | Performs smart model-based compression or pruning on your conversation history. |
| **`/context [dir]`**| `[dir]` *(optional)* | Scans a directory tree, generating an optimized memory map to inject as context. |
| **`/exit` or `/quit`**| None | Gracefully disconnects subprocesses, shuts down web servers, and exits. |

---

## 🛠️ Command Details

### ⚙️ System & Diagnostics

#### `/help` or `/help [cmd]`
Displays a gorgeous, colorized guide on how to interact with the REPL, including terminal shortcuts (like `Up`/`Down`/`Ctrl+R` for history navigation) and details on slash commands.

#### `/features`
Renders a colorized, high-end block banner summarizing Plumar's capabilities, including its Model Context Protocol support, 35 validated tools, security sandbox, and synthetic audio arcade game.

#### `/info` or `/info json`
Retrieves live chat diagnostics.
- **Standard (`/info`)**: Displays the active model, host, workspace root, profile mode, and exact count of items in the conversation context.
- **JSON (`/info json`)**: Outputs raw JSON diagnostics, ideal for script pipelines or verification tests.

#### `/verbose`
Toggles verbose JSON logging. When enabled, the terminal prints raw API request payloads (including messages arrays, tool declarations, and completion response parameters) on every model turn.

#### `/adk-info`
Toggles internal verbose logging from `@google/adk`. By default, ADK logging is silenced. Enabling it allows developers to inspect real-time tool binding and schema translation operations.

---

### 🌐 Model & Connection Configuration

#### `/mode` or `/mode <name>`
Changes the conversational **Profile (Mode)**. Adjusting the mode immediately shifts the model temperature and applies a specialized system prompt instructions layer:
- **`balanced`** (default): Best for everyday code engineering, problem-solving, and folder queries (`temp: 0.7`).
- **`code`**: Rigid, logical software architecture, syntax compilation, and bug fixing (`temp: 0.2`).
- **`system`**: Dense tables, calculations, raw script execution, and ultra-short bullet lists (`temp: 0.1`).
- **`creative`**: High-entropy lateral thinking, design mockups, and open brainstorming (`temp: 0.9`).

#### `/model`
Triggers **Dynamic Model Swapping & Parameter Calibration**.
1. Polls local/remote Ollama for installed tags.
2. Renders a numbered selection list.
3. Prompts for a custom model temperature (`0.0` to `1.0`), allowing you to override the active profile's default.
4. Dynamically binds the session to the new LLM and temperature without losing chat memory.

#### `/host` or `/host <url>`
Switches your Ollama API server endpoint. 
- Typing `/host` displays your current connection URL.
- Typing `/host http://192.168.1.50:11434` redirects the agent to look for a remote Ollama server.

#### `/settings`
A unified interactive cockpit for managing connection endpoints, authentication, active logging, and default tool behaviors. 
- **Endpoint Input**: Easily change the Ollama host.
- **Authentication**: Input custom authorization headers or API tokens.
  - If you input a key with a colon (e.g. `X-API-Key: my-token`), Plumar sends it as a custom HTTP header.
  - If you input a token (e.g. `my_secret_token`), Plumar sends it as standard `Authorization: Bearer my_secret_token`.
  - Supports standard `Basic` and `Bearer` keywords if prefixed.
- Settings are automatically persisted inside the session's active policy config file!

---

### 💾 Session & History Management

#### `/sessions`
Provides rich session state control.
- `/sessions list`: Lists all stored conversation files, showing models used and timestamps.
- `/sessions load <id>`: Swaps active session memory to a historical thread.
- `/sessions delete <id>`: Removes a conversation history file from disk.
- `/sessions rename <id> <new_name>`: Renames a session file.

#### `/history`
Dumps your entire REPL prompt input history. Plumar loads and registers all past prompts sequentially upon startup, ensuring that **Up Arrow**, **Down Arrow**, and **`Ctrl+R` Fuzzy Reverse Search** are instantly functional.

#### `/clear`
ANSI-clears your screen and flushes the active LLM conversation memory array. Essential for switching topics to prevent previous chat contexts from bloating your tokens.

#### `/minimize`
Enables context footprint management. Compresses conversation history by pruning metadata or employing an LLM-based summarization turn to condense long threads.

#### `/context [directory]`
Recursively indexes the workspace folder structure (ignoring node files), creating a clean, structured directory tree markdown map and injecting it directly into the agent's memory.

---

### 🔌 Custom Extension Wizards

#### `/skills`
Lists all YAML-styled agentic skills loaded from the `./skills/` directory.

#### `/add-skill`
Launches an interactive authoring CLI wizard. Prompts you for a skill name, description, and system prompt instructions. It automatically compiles and writes a `.yaml` skill file, making it instantly loadable.

#### `/plugins`
Lists all loaded custom ESM JavaScript code plugins.

#### `/add-plugin`
Launches an interactive plugin template generator. Prompts for file name, tool name, and description. It generates a standardized `@google/adk` compatible ESM tool file in the `./plugins/` folder that compiles on subsequent startups.

---

### 🛡️ Tool Security Policy

#### `/policy` or `/policy [default|<tool_name>] [allow|ask|deny]`
Enables fine-grained, run-time security gates for tool executions. Every tool can operate in one of three modes:
- **`allow`**: Automatically approve and execute the tool call directly (default).
- **`ask`**: Pauses execution and prints the parameters, asking for manual user approval (`Y/N`) first.
- **`deny`**: Blocks execution immediately, returning an error back to the LLM.

##### Examples:
- `/policy`: View current active policies.
- `/policy ask`: Changes default policy to ask before executing *any* tool.
- `/policy deleteFile deny`: Disallows the agent from deleting files under any circumstances.
- `/policy config my-security.json`: Loads/saves custom policies persistently.
- **Zero-Config**: If `policy-config.json` is in the workspace root, it is loaded automatically on startup.

---

### 🚪 Application Control

#### `/exit` or `/quit`
Gracefully closes connections, terminates Model Context Protocol subprocesses, shuts down local HTTP game servers, and cleanly exits the process.
