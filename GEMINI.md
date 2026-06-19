# plumar-cli - Custom Tools & Rebranding Guide

This file outlines the complete set of instructions provided during our session, their implementations, and a comprehensive guide to all available workspace tools.

---

## 📋 Session Instructions

1. **New Tools Addition**: Add commonly needed developer tools that make sense, and create a new tool to launch/play a Chrome Dino-like game.
2. **Rebranding**: Change the Dino Game's name and styling references from **"Antigravity Dino"** to **"plumar-cli Dino"**.
3. **ADK Info Toggle**: Allow the user to enable/disable info (internal logging) from ADK (`@google/adk`), which should be disabled by default.

---

## 🛠️ Complete Workspace Tools Reference

The plumar-cli environment now features a robust suite of **19 core tools** to assist with math, diagnostics, workspace organization, advanced editing, terminal workflows, and interactive testing.

### 🔌 1. Coding & Terminal Utilities (Core Workflow)
| Tool Name | Description | Key Parameters |
| :--- | :--- | :--- |
| **`executeCommand`** 🆕 | Safely executes terminal commands in the workspace with a standard 30s timeout and detailed stdout/stderr capturing. | `command` (e.g., `"npm run test"`) |
| **`searchReplace`** 🆕 | Finds a specific text block inside any file and replaces it with a new block, ensuring safe precise modifications. | `filePath`, `findText`, `replaceText` |
| **`searchGrep`** | Performs a robust text search or Regex match across all files in the workspace (automatically ignoring ignored directories). | `query`, `directory`, `isRegex` |

### 📂 2. File & Folder Operations
| Tool Name | Description | Key Parameters |
| :--- | :--- | :--- |
| **`findFiles`** 🆕 | Recursively searches the workspace for files matching a specific pattern (supports wildcards like `*.js`). | `pattern`, `directory` |
| **`listFiles`** | Recursively lists all workspace directory contents, automatically filtering out dependency folders and lock files. | `directory` |
| **`readFile`** | Reads the content of a text file inside the workspace, safely truncating outputs to 10,000 characters to protect context. | `filePath` |
| **`writeFile`** | Creates a new text file or fully overwrites an existing file with the provided text. | `filePath`, `content` |
| **`appendFile`** | Appends text content to the end of an existing file (implicitly creates the file if missing). | `filePath`, `content` |
| **`deleteFile`** | Safely removes a file from the workspace filesystem. | `filePath` |
| **`makeDirectory`** | Explicitly creates a new directory, supporting deeply nested folder creation. | `directoryPath` |
| **`writeMarkdown`** | Builds a highly structured markdown file (`.md`) from a list of sections, headings, and section bodies. | `filePath`, `title`, `sections` |

### 💻 3. System & Network Diagnostics
| Tool Name | Description | Key Parameters |
| :--- | :--- | :--- |
| **`getSystemInfo`** | Retrieves current local system diagnostics (OS platform, CPU model, core count, uptime, and RAM consumption). | *(none)* |
| **`getCurrentTime`** | Returns the exact local date, timestamp, and timezone offset of the host machine. | *(none)* |
| **`fetchWebPage`** | Fetches the body text/JSON of any public HTTP/HTTPS URL or API endpoint. | `url` |
| **`fetchImage`** 🆕 | Fetch/download an image file from a remote HTTP/HTTPS URL and save it securely inside the workspace. | `url`, `outputPath` |
| **`apiPerformanceTest`** 🆕 | Executes a concurrent load and performance test on any API endpoint, compiling latency stats (min, max, avg, p95, p99) and success rates. | `url`, `method`, `requests`, `concurrency`, `headers`, `body` |
| **`calculator`** | Safely evaluates standard math expressions. Supports addition, subtraction, multiplication, division, modulo, and brackets. | `expression` (e.g. `"(4 + 5) * 3"`) |

### 👾 4. Interactive & Fun
| Tool Name | Description | Key Parameters |
| :--- | :--- | :--- |
| **`dinoGame`** 🆕 | Spins up a local Node.js HTTP server and automatically opens the **plumar-cli Dino** web game in your default browser. | `action` (`"start"` \| `"stop"` \| `"status"`) |
| **`createAsciiArt`** 🆕 | Generates beautiful, retro-styled ASCII art using high-fidelity block/slant fonts, customized shapes (heart, star, dino, rocket, coffee), or a loaded image file (PNG, JPEG, etc.) with optional 24-bit TrueColor ANSI output. | `text`, `font` (`"block"` \| `"slant"`), `presetShape` (`"heart"` \| `"star"` \| `"dino"` \| `"rocket"` \| `"coffee"`), `imagePath` (string), `imageWidth` (number), `colored` (boolean) |

### 🔌 5. Advanced Developer Utilities (Database, Process, Git & Linter Tools) 🆕
| Tool Name | Description | Key Parameters |
| :--- | :--- | :--- |
| **`portManager`** 🆕 | Query processes active on a network port, or terminate a process by port or PID to resolve port-in-use blocks. | `action` (`"list"` \| `"kill"`), `port`, `pid` |
| **`restClient`** 🆕 | Constructs and executes custom HTTP API requests (GET, POST, PUT, DELETE, PATCH) to test external REST interfaces with timing stats, custom headers, and bodies. | `url`, `method`, `headers`, `body` |
| **`regexHelper`** 🆕 | Evaluates, matches, or replaces text strings using high-performance regular expressions with customizable flags. | `action` (`"test"` \| `"match"` \| `"replace"`), `pattern`, `flags`, `text`, `replacement` |
| **`codeFormatter`** 🆕 | Formats or lints files in-place using project ESLint or Prettier config, with a graceful missing-configuration fallback. | `filePath`, `action` (`"format"` \| `"lint"`) |
| **`dependencyScanner`** 🆕 | Scans workspace imports and cross-references `package.json` to detect unused or undeclared node dependencies, as well as outdated libraries. | `action` (`"scanImports"` \| `"checkOutdated"` \| `"audit"`) |
| **`gitHelper`** 🆕 | Retrieves repository status, formatted logs, file diffs, and automatically drafts intelligent commit messages based on staged changes. | `action` (`"status"` \| `"diff"` \| `"log"` \| `"draftCommitMessage"`) |
| **`dbExplorer`** 🆕 | Inspects schemas, explores tables, and executes custom queries on PostgreSQL and MySQL databases with zero-dependency CLI pipelines. | `connectionUri`, `action` (`"schema"` \| `"query"`), `sql` |

---

## 👾 The plumar-cli Dino Game

A fully custom, high-fidelity browser game was designed and placed inside `dino-game/index.html`. It runs with pure client-side HTML, CSS, and Javascript.

### 🌟 Game Features:
* **Deep Space Aesthetics**: Vibrant retro-neon color schemes with a glowing geometric T-Rex, scrolling procedural floors, and twinkling parallax-star backdrops.
* **Synthesized Audio Sound FX**: Powered entirely by the **Web Audio API** (requires no external audio files). Generates nostalgic 8-bit sound waves for jumps, gravity flips, milestone high scores, and crashes.
* **Gravity Physics Modes**:
  1. **Standard Gravity**: Classic Chrome Dino jumping and ducking.
  2. **Low Gravity**: Smooth low-G gliding physics.
  3. **Gravity Flip Mode**: Dino can run on the ceiling! Flip gravity upside-down on-the-fly.
* **Score & Stats Tracker**: Tracks real-time score, increases game speed as score rises, and saves high scores persistently to the browser's `localStorage` (keyed under `plumar_cli_high_score`).

### 🎮 Game Controls:
* **Jump / Glide Up**: `Space` or `↑ Arrow` (or click/tap on the screen)
* **Duck / Slam Down**: `↓ Arrow`
* **Flip Gravity**: `Shift` or `F`

---

## 🏷️ Rebranding (From "Antigravity Dino" to "plumar-cli Dino")

All branding was migrated from "Antigravity" to **"plumar-cli"** to align with the product name:

* **`dino-game/index.html`**:
  * Title updated to `<title>plumar-cli Dino Game</title>`.
  * Game header rebranded to `PLUMAR DINO`.
  * Footer credits rebranded to `Powered by plumar-cli AI CLI Engine`.
  * LocalStorage high-score keys updated to `plumar_cli_high_score`.
* **`tools.js`**:
  * Tool description, active server URLs, launch success text, and shutdown messages updated to refer to **plumar-cli Dino**.

---

## 🔌 Controlling ADK Info Logging

By default, internal verbose logging/telemetry from ADK (`@google/adk`) is **disabled** to keep the terminal REPL neat, concise, and focused on agent responses.

### ⚙️ How to Toggle ADK Info Logs:
1. **Startup CLI Flag**: Start the CLI with `--adk-info` or `--enable-adk-info` to enable internal ADK logging:
   ```bash
   npm start -- --adk-info
   ```
2. **Environment Variable**: Set `ADK_INFO=true` in your environment:
   ```bash
   ADK_INFO=true npm start
   ```
3. **Interactive REPL Command**: Toggle logging dynamically during a session by typing the slash command:
   ```
   /adk-info
   ```
4. **Diagnostics Verification**: View the current state of ADK logging using `/info` or `--info`.

---

## 🚀 How to Run & Test

### Run Integration Tests
To ensure everything works flawlessly and no syntax or runtime exceptions occur, run the built-in tests:
```bash
node --test tests/tools.test.js
```

### Launch the Dino Game Server
Tell the plumar-cli agent to start the game, or invoke it directly:
* **Start Server**: Launches the HTTP server and opens your web browser to `http://localhost:3456`.
* **Check Status**: Verifies if the game server is active and outputs the active URL.
* **Stop Server**: Gracefully shuts down the HTTP server.

---

## 🧭 The `/features` Slash Command Option

To showcase the rich, high-end technical features integrated into **plumar-cli**, a new interactive slash command has been introduced:

```bash
/features
```

### 🌟 Covered Capabilities:
1. **Interactive Dino Game**: Launches the client-side synth-audio browser game (`/dino-game` or running the `dinoGame` tool) with procedural floors, low-G physics, real-time ceiling gravity flips, and high-score persisting.
2. **Advanced Developer Utilities**:
   - Zero-dependency PostgreSQL and MySQL database schema/query explorers.
   - Intelligent Git status, diff, log, and automated commit message drafting.
   - Concurrent API performance and latency load tester.
   - ESLinter and code formatting helpers, custom network port managers, regex checkers, and dependency scanners.
3. **Custom Sandbox Boundaries**: Real-time permission overrides (ALLOW, ASK, DENY) on a per-tool level.
4. **Active Session Persistence**: Save/load REPL histories seamlessly, Ctrl+R interactive reverse history search, and prompt pipe operators.
5. **Model Context Protocol Integration**: Fully standard-compliant MCP server client support.
