# 🛠️ Complete Tools Reference

The **plumar-cli** (Plumar) contains a highly integrated developer toolset consisting of **35 powerful workspace, system, network, media, database, and custom extension tools**. All tools are schema-validated using `Zod` and constructed with `@google/adk`.

---

## 📂 Category Navigation

1. [📂 File & Workspace Managers](#1-file--workspace-managers)
2. [⚙️ Coding, Git & Terminal Utilities](#2-coding-git--terminal-utilities)
3. [🌐 Network, API & Load Testing](#3-network-api--load-testing)
4. [📊 Data, Cryptography & Media Engines](#4-data-cryptography--media-engines)
5. [🧠 Custom Skills, Plugins & Fun](#5-custom-skills-plugins--fun)

---

## 📂 1. File & Workspace Managers

### `listFiles`
Recursively maps the workspace directory tree structure.
- **Parameters**:
  - `directory` *(string, optional)*: Relative path to list contents of. Defaults to `.`.
- **Safety & Performance**: Automatically filters out heavy developer noise folders like `node_modules`, `.git`, `.antigravitycli`, `.gemini`, and bulky lock files (such as `package-lock.json`) to keep your prompt context window lean.

### `readFile`
Reads plain-text files from the workspace.
- **Parameters**:
  - `filePath` *(string, required)*: Relative or absolute path of the file to read.
- **Safety & Performance**: Guarded by `resolveSafePath` to prevent directory traversal. Files longer than **10,000 characters** are automatically truncated to protect your model's context window.

### `writeFile`
Writes or fully overwrites plain-text files inside the workspace boundaries.
- **Parameters**:
  - `filePath` *(string, required)*: Relative path where the file should be written.
  - `content` *(string, required)*: Plain-text content to write.
- **Safety & Performance**: Guarded by `resolveSafePath`. Recursively builds parent directories automatically if they do not exist.

### `appendFile`
Appends text to the end of an existing file.
- **Parameters**:
  - `filePath` *(string, required)*: Relative path to target.
  - `content` *(string, required)*: Plain text to append.
- **Safety & Performance**: Guarded by `resolveSafePath`. Implicitly creates the file if it does not exist.

### `deleteFile`
Safely removes a file from the filesystem.
- **Parameters**:
  - `filePath` *(string, required)*: Relative path of the file to remove.
- **Safety & Performance**: Guarded by `resolveSafePath`. Returns an error message if the file is missing rather than crashing.

### `makeDirectory`
Recursively creates new directories inside the active workspace.
- **Parameters**:
  - `directoryPath` *(string, required)*: Relative directory path.
- **Safety & Performance**: Guarded by `resolveSafePath`.

### `writeMarkdown`
Generates a highly structured, valid Markdown (`.md`) file using a schema-validated heading and section list.
- **Parameters**:
  - `filePath` *(string, required)*: Target relative path.
  - `title` *(string, required)*: Main `#` title.
  - `sections` *(array of objects, required)*: Heading objects (containing `heading` string, `level` integer, and `body` string).
- **Safety & Performance**: Guarded by `resolveSafePath`.

---

## ⚙️ 2. Coding, Git & Terminal Utilities

### `executeCommand`
Runs bash shell commands on the host machine.
- **Parameters**:
  - `command` *(string, required)*: Bash command string (e.g., `"npm run test"`).
- **Safety & Performance**: Captures stdout and stderr. Features a default **30-second timeout** to prevent orphan hang processes.

### `searchReplace`
Performs precise, single-match find-and-replace on a targeted file.
- **Parameters**:
  - `filePath` *(string, required)*: Relative path to modify.
  - `findText` *(string, required)*: The exact multi-line text block to find.
  - `replaceText` *(string, required)*: The new text block.
- **Safety & Performance**: Guarded by `resolveSafePath`. Rejects if the file is missing or the search block isn't uniquely matched.

### `searchGrep`
A fast text-searching tool matching literal text or regular expressions across workspace files.
- **Parameters**:
  - `query` *(string, required)*: Text or regex search term.
  - `directory` *(string, optional)*: Subfolder scope. Defaults to `.`.
  - `isRegex` *(boolean, optional)*: Set to `true` to evaluate `query` as regex.
- **Safety & Performance**: Automatically skips binary files, hidden folders, and dependency directories to preserve performance.

### `findFiles`
Recursively finds files in the workspace matching wildcard patterns.
- **Parameters**:
  - `pattern` *(string, required)*: Wildcard query (e.g. `"*.js"`, `"test*"`).
  - `directory` *(string, optional)*: Subdirectory scope. Defaults to `.`.
- **Safety & Performance**: Guarded by `resolveSafePath`.

### `portManager`
Queries network ports or terminates blocking network processes.
- **Parameters**:
  - `action` *(string: `"list"` or `"kill"`, required)*: Command to list port details or kill processes.
  - `port` *(number, optional)*: Query/kill target port (e.g., `3000`).
  - `pid` *(number, optional)*: Direct Process ID to kill.

### `regexHelper`
Evaluates, tests, or replaces strings using high-performance regular expressions.
- **Parameters**:
  - `action` *(string: `"test"`, `"match"`, or `"replace"`, required)*: The action to perform.
  - `pattern` *(string, required)*: Regular expression pattern string.
  - `flags` *(string, optional)*: Regex flag modifiers (e.g. `"gi"`).
  - `text` *(string, required)*: The input body text.
  - `replacement` *(string, optional)*: Replacer value (required for `"replace"` action).

### `codeFormatter`
Runs project-level linter and code formatting helpers.
- **Parameters**:
  - `filePath` *(string, required)*: Relative file path to parse.
  - `action` *(string: `"format"` or `"lint"`, optional)*: Action to run. Defaults to `"format"`.
- **Safety & Performance**: Runs local `eslint` or `prettier` if configured, and falls back to a built-in clean-printer if configurations are missing.

### `dependencyScanner`
Scans imports and audits workspace npm dependencies.
- **Parameters**:
  - `action` *(string: `"scanImports"`, `"checkOutdated"`, or `"audit"`, optional)*: Action to run. Defaults to `"scanImports"`.

### `gitHelper`
Queries local git status, logs, diffs, or drafts a descriptive commit message based on staged changes.
- **Parameters**:
  - `action` *(string: `"status"`, `"diff"`, `"log"`, or `"draftCommitMessage"`, optional)*: Defaults to `"status"`.

### `dbExplorer`
Zero-dependency database explorer to inspect schema catalogs or execute queries on live databases.
- **Parameters**:
  - `connectionUri` *(string, required)*: DB URI (e.g. `"postgres://user:pass@localhost:5432/db"`).
  - `action` *(string: `"schema"` or `"query"`, required)*: Exploration mode.
  - `sql` *(string, optional)*: Custom query (required for `"query"` action).

---

## 🌐 Network, API & Load Testing

### `fetchWebPage`
Downloads and parses public web page URLs or REST API JSON responses.
- **Parameters**:
  - `url` *(string, required)*: Target URL (HTTP/HTTPS).
- **Safety & Performance**: Features an automatic **8-second timeout**. Strips useless HTML `<script>` / `<style>` sections and formats elements to readable text. Truncates results over **5,000 characters**.

### `fetchImage`
Downloads remote images into your workspace securely.
- **Parameters**:
  - `url` *(string, required)*: Direct URL of the remote image.
  - `outputPath` *(string, required)*: Relative path to save the image (e.g., `assets/logo.png`).
- **Safety & Performance**: Guarded by `resolveSafePath`. Validates remote headers to ensure standard image binary payloads.

### `restClient`
Constructs and executes custom REST API HTTP requests (GET, POST, PUT, DELETE, PATCH).
- **Parameters**:
  - `url` *(string, required)*: API Endpoint URL.
  - `method` *(string, optional)*: HTTP verb. Defaults to `"GET"`.
  - `headers` *(object, optional)*: Custom request headers key-value map.
  - `body` *(string, optional)*: Payload data string.

### `apiPerformanceTest`
Runs concurrent HTTP load-tests on any API endpoint, compiling latencies.
- **Parameters**:
  - `url` *(string, required)*: API endpoint to target.
  - `method` *(string, optional)*: Defaults to `"GET"`.
  - `requests` *(number, optional)*: Total requests to execute (Max `500`). Defaults to `100`.
  - `concurrency` *(number, optional)*: Parallel request threads (Max `20`). Defaults to `10`.
  - `headers` *(object, optional)*: Custom headers map.
  - `body` *(string, optional)*: JSON payload.

---

## 📊 4. Data, Cryptography & Media Engines

### `base64Convert`
Encodes text/files to Base64, or decodes Base64 data strings back into text or binary files.
- **Parameters**:
  - `action` *(string: `"encode"` or `"decode"`, required)*: Direction.
  - `inputType` *(string: `"text"` or `"file"`, optional)*: Input source. Defaults to `"text"`.
  - `input` *(string, required)*: Raw text / relative file path to convert.
  - `outputPath` *(string, optional)*: Relative path to write output.

### `generateMockData`
Generates customized, realistic datasets in JSON, CSV, XML, or YAML layouts.
- **Parameters**:
  - `preset` *(string: `"users"`, `"products"`, `"orders"`, `"transactions"`, `"custom"`, optional)*: Defaults to `"users"`.
  - `format` *(string: `"json"`, `"csv"`, `"xml"`, `"yaml"`, optional)*: Defaults to `"json"`.
  - `count` *(number, optional)*: Output rows (Max `500`). Defaults to `10`.
  - `customFields` *(array of objects, optional)*: Fields schema array when preset is `"custom"`.

### `generateHash`
Computes MD5, SHA-1, SHA-256, or SHA-512 hashes for plain text or workspace files.
- **Parameters**:
  - `algorithm` *(string: `"md5"`, `"sha1"`, `"sha256"`, `"sha512"`, optional)*: Defaults to `"sha256"`.
  - `inputType` *(string: `"text"` or `"file"`, optional)*: Defaults to `"text"`.
  - `input` *(string, required)*: Target text or file path.
  - `encoding` *(string: `"hex"`, `"base64"`, `"latin1"`, optional)*: Digest style. Defaults to `"hex"`.

### `generateImage` (ALPHA)
Procedurally draws custom images (PNG/JPEG) offline using shapes, text, or fallback Generative AI.
- **Parameters**:
  - `outputPath` *(string, required)*: Relative path to save.
  - `prompt` *(string, required)*: Visual description to draw.
  - `width` *(number, optional)*: Image width in pixels. Defaults to `400`.
  - `height` *(number, optional)*: Image height in pixels. Defaults to `400`.
  - `backgroundColor` *(string, optional)*: Hex color code (e.g. `"#ffffff"`).
  - `drawings` *(array of objects, optional)*: Explicit canvas shape drawings list.

### `generateVideo` (ALPHA)
Generates customized video files based on prompts using Google Veo (with offline mocking fallback).
- **Parameters**:
  - `outputPath` *(string, required)*: Path to save MP4.
  - `prompt` *(string, required)*: Video scene description.
  - `aspectRatio` *(string: `"16:9"`, `"9:16"`, `"1:1"`, optional)*: Defaults to `"16:9"`.

---

## 🧠 5. Custom Skills, Plugins & Fun

### `listSkills`
Lists all active custom agentic YAML-styled skills registered in `./skills/`.
- **Parameters**: None.

### `loadSkill`
Dynamically appends a custom registered skill's system instructions to the active agent conversation context.
- **Parameters**:
  - `skillName` *(string, required)*: The filename of the skill (excluding extension).

### `createSkill`
Compiles and saves a new custom agentic skill file into the `./skills/` folder.
- **Parameters**:
  - `name` *(string, required)*: Skill file name.
  - `description` *(string, required)*: Frontmatter description.
  - `instructions` *(string, required)*: System instructions.

### `createPlugin`
Generates an ESM JavaScript tool plugin boilerplate inside `./plugins/` that complies with `@google/adk` tool structures.
- **Parameters**:
  - `fileName` *(string, required)*: Plugin file name (e.g. `"my-tool.js"`).
  - `toolName` *(string, required)*: Tool registration name.
  - `description` *(string, required)*: Schema description.

### `calculator`
Safe math expression evaluator rejecting execution injection vectors.
- **Parameters**:
  - `expression` *(string, required)*: Mathematical string expression (e.g. `"(12.5 + 4) * 5"`).

### `getSystemInfo`
Retrieves live CPU model, architecture, platform release, uptime hours, and RAM details.
- **Parameters**: None.

### `getCurrentTime`
Returns local machine time, ISO format timestamps, and active timezone minute offsets.
- **Parameters**: None.

### `createAsciiArt`
Renders beautiful text banners or custom retro shapes with option for 24-bit TrueColor ANSI formats.
- **Parameters**:
  - `text` *(string, optional)*: Word/banner to render.
  - `font` *(string: `"block"` or `"slant"`, optional)*: Defaults to `"block"`.
  - `presetShape` *(string: `"heart"`, `"star"`, `"dino"`, `"rocket"`, `"coffee"`, optional)*: High-fidelity drawing presets.
  - `imagePath` *(string, optional)*: Relative path to an image (PNG/JPEG) to convert into block terminal characters.
  - `imageWidth` *(number, optional)*: Column width in terminal (Max `150`). Defaults to `60`.
  - `colored` *(boolean, optional)*: Enables full terminal colors. Defaults to `true`.

### `dinoGame`
Spins up a lightweight Node.js web server and automatically opens the rebranded **plumar-cli Dino Game** in your default web browser.
- **Parameters**:
  - `action` *(string: `"start"`, `"stop"`, or `"status"`, required)*: Launches, halts, or queries the active HTTP game server.
