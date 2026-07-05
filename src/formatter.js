// Pre-emptively define globalThis.fs with intercepting write/writeSync to filter terminal queries (OSC 10/11/4 and Cursor/DSR)
// so that Go's WASM engine (charsm/termenv) does not overwrite it or send queries to the terminal.
if (typeof globalThis !== 'undefined' && !globalThis.fs) {
  let outputBuf = "";
  const decoder = new TextDecoder("utf-8");
  const enosys = () => {
    const err = new Error("not implemented");
    err.code = "ENOSYS";
    return err;
  };
  globalThis.fs = {
    constants: { O_WRONLY: -1, O_RDWR: -1, O_CREAT: -1, O_TRUNC: -1, O_APPEND: -1, O_EXCL: -1 },
    writeSync(fd, buf) {
      const decoded = decoder.decode(buf);
      if (
        decoded.includes('\x1b]11;') || decoded.includes('\u001b]11;') || 
        decoded.includes('\x1b]10;') || decoded.includes('\u001b]10;') ||
        decoded.includes('\x1b]4;') || decoded.includes('\u001b]4;') ||
        decoded.includes('\x1b[6n') || decoded.includes('\u001b[6n') ||
        decoded.includes('\x1b[?6n') || decoded.includes('\u001b[?6n') ||
        decoded.includes('\x1b[5n') || decoded.includes('\u001b[5n') ||
        decoded.includes('\x1b[c') || decoded.includes('\u001b[c') ||
        decoded.includes('\x1b[0c') || decoded.includes('\u001b[0c') ||
        decoded.includes('\x1b[>0c') || decoded.includes('\u001b[>0c') ||
        decoded.includes('\x1b[>c') || decoded.includes('\u001b[>c')
      ) {
        return buf.length;
      }
      outputBuf += decoded;
      const nl = outputBuf.lastIndexOf("\n");
      if (nl != -1) {
        console.log(outputBuf.substring(0, nl));
        outputBuf = outputBuf.substring(nl + 1);
      }
      return buf.length;
    },
    write(fd, buf, offset, length, position, callback) {
      if (offset !== 0 || length !== buf.length || position !== null) {
        if (typeof callback === 'function') callback(enosys());
        return;
      }
      const n = this.writeSync(fd, buf);
      if (typeof callback === 'function') callback(null, n);
    },
    chmod(path, mode, callback) { if (typeof callback === 'function') callback(enosys()); },
    chown(path, uid, gid, callback) { if (typeof callback === 'function') callback(enosys()); },
    close(fd, callback) { if (typeof callback === 'function') callback(enosys()); },
    fchmod(fd, mode, callback) { if (typeof callback === 'function') callback(enosys()); },
    fchown(fd, uid, gid, callback) { if (typeof callback === 'function') callback(enosys()); },
    fstat(fd, callback) { if (typeof callback === 'function') callback(enosys()); },
    fsync(fd, callback) { if (typeof callback === 'function') callback(null); },
    ftruncate(fd, length, callback) { if (typeof callback === 'function') callback(enosys()); },
    lchown(path, uid, gid, callback) { if (typeof callback === 'function') callback(enosys()); },
    link(path, link, callback) { if (typeof callback === 'function') callback(enosys()); },
    lstat(path, callback) { if (typeof callback === 'function') callback(enosys()); },
    mkdir(path, perm, callback) { if (typeof callback === 'function') callback(enosys()); },
    open(path, flags, mode, callback) { if (typeof callback === 'function') callback(enosys()); },
    read(fd, buffer, offset, length, position, callback) { if (typeof callback === 'function') callback(enosys()); },
    readdir(path, callback) { if (typeof callback === 'function') callback(enosys()); },
    readlink(path, callback) { if (typeof callback === 'function') callback(enosys()); },
    rename(from, to, callback) { if (typeof callback === 'function') callback(enosys()); },
    rmdir(path, callback) { if (typeof callback === 'function') callback(enosys()); },
    stat(path, callback) { if (typeof callback === 'function') callback(enosys()); },
    symlink(path, link, callback) { if (typeof callback === 'function') callback(enosys()); },
    unlink(path, callback) { if (typeof callback === 'function') callback(enosys()); },
    utimes(path, atime, mtime, callback) { if (typeof callback === 'function') callback(enosys()); }
  };
}

import fs from 'node:fs';

// Helper to check if string/buffer contains terminal query sequences (color, cursor, device status)
function isTerminalQuery(chunk) {
  if (!chunk) return false;
  let str = '';
  if (typeof chunk === 'string') {
    str = chunk;
  } else if (chunk instanceof Uint8Array || Buffer.isBuffer(chunk)) {
    str = chunk.toString('utf8');
  }
  return (
    str.includes('\x1b]11;') || str.includes('\u001b]11;') || 
    str.includes('\x1b]10;') || str.includes('\u001b]10;') ||
    str.includes('\x1b]4;') || str.includes('\u001b]4;') ||
    str.includes('\x1b[6n') || str.includes('\u001b[6n') ||
    str.includes('\x1b[?6n') || str.includes('\u001b[?6n') ||
    str.includes('\x1b[5n') || str.includes('\u001b[5n') ||
    str.includes('\x1b[c') || str.includes('\u001b[c') ||
    str.includes('\x1b[0c') || str.includes('\u001b[0c') ||
    str.includes('\x1b[>0c') || str.includes('\u001b[>0c') ||
    str.includes('\x1b[>c') || str.includes('\u001b[>c')
  );
}

// 1. Intercept low-level fs.writeSync for file descriptors 1 (stdout) and 2 (stderr)
const originalWriteSync = fs.writeSync;
fs.writeSync = function(fd, buffer, ...args) {
  if (fd === 1 || fd === 2) {
    if (isTerminalQuery(buffer)) {
      return buffer.length;
    }
  }
  return originalWriteSync.call(this, fd, buffer, ...args);
};

// 2. Intercept high-level process.stdout.write and process.stderr.write
if (typeof process !== 'undefined') {
  if (process.stdout && typeof process.stdout.write === 'function') {
    const originalStdoutWrite = process.stdout.write;
    process.stdout.write = function(chunk, encoding, callback) {
      if (isTerminalQuery(chunk)) {
        if (typeof encoding === 'function') encoding();
        else if (typeof callback === 'function') callback();
        return true;
      }
      return originalStdoutWrite.call(process.stdout, chunk, encoding, callback);
    };
  }

  if (process.stderr && typeof process.stderr.write === 'function') {
    const originalStderrWrite = process.stderr.write;
    process.stderr.write = function(chunk, encoding, callback) {
      if (isTerminalQuery(chunk)) {
        if (typeof encoding === 'function') encoding();
        else if (typeof callback === 'function') callback();
        return true;
      }
      return originalStderrWrite.call(process.stderr, chunk, encoding, callback);
    };
  }
}

// Helper to strip terminal responses from input chunks (color/cursor replies)
function stripTerminalResponses(chunk) {
  if (!chunk) return chunk;
  
  const isBuffer = Buffer.isBuffer(chunk);
  let str = isBuffer ? chunk.toString('utf8') : chunk;
  
  // Pattern 1: OSC responses (ESC ] 10/11/4 ; ... BEL or ST)
  str = str.replace(/\x1b\](?:10|11|4);[^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
  str = str.replace(/\u001b\](?:10|11|4);[^\x07\u001b]*(?:\x07|\u001b\\)/g, '');

  // Pattern 2: Cursor Position Reports (CPR: ESC [ <digits> ; <digits> R)
  str = str.replace(/\x1b\[\d+(?:;\d+)*R/g, '');
  str = str.replace(/\u001b\[\d+(?:;\d+)*R/g, '');
  
  // Pattern 3: Device Status/Attributes (ESC [ ? / > <digits> c)
  str = str.replace(/\x1b\[\??\d+(?:;\d+)*c/g, '');
  str = str.replace(/\u001b\[\??\d+(?:;\d+)*c/g, '');
  str = str.replace(/\x1b\[>\d+(?:;\d+)*c/g, '');
  str = str.replace(/\u001b\[>\d+(?:;\d+)*c/g, '');

  // Pattern 4: Fragment-resistant patterns for split stream chunks
  str = str.replace(/rgb:[0-9a-fA-F/]+/gi, '');
  str = str.replace(/(?:[0-9a-fA-F]{1,4}\/)+[0-9a-fA-F]{1,4}/gi, '');
  str = str.replace(/\d+;rgb:/gi, '');
  str = str.replace(/\b10;\b/g, '');
  str = str.replace(/\b11;\b/g, '');
  str = str.replace(/\b\d+;\d+R\b/gi, '');
  str = str.replace(/\b\d+R\b/gi, '');
  str = str.replace(/[\x07]/g, '');
  
  if (isBuffer) {
    return Buffer.from(str, 'utf8');
  }
  return str;
}

// 3. Intercept input stream (process.stdin) data events to strip any pre-existing or late-arriving terminal query responses
if (typeof process !== 'undefined' && process.stdin && typeof process.stdin.emit === 'function') {
  const originalEmit = process.stdin.emit;
  process.stdin.emit = function(event, ...args) {
    if (event === 'data' && args[0]) {
      const filtered = stripTerminalResponses(args[0]);
      if (filtered === '' || (Buffer.isBuffer(filtered) && filtered.length === 0)) {
        return true; // Discard event completely
      }
      args[0] = filtered;
    }
    return originalEmit.apply(this, [event, ...args]);
  };
}

import pc from 'picocolors';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';

let initLip = null;
let Lipgloss = null;
let lipInstance = null;
let isLipInitialized = false;

export async function initializeFormatter() {
  if (isLipInitialized) return;

  // Only attempt to load and initialize charsm if running on supported x86_64 architectures
  // (since charsm bundles x86_64 native binary libraries)
  if (process.arch !== 'x64' || (process.platform !== 'linux' && process.platform !== 'win32')) {
    return;
  }

  try {
    const charsmModule = await import('charsm');
    initLip = charsmModule.initLip;
    Lipgloss = charsmModule.Lipgloss;

    const success = await initLip();
    if (success) {
      lipInstance = new Lipgloss();
      isLipInitialized = true;
    }
  } catch (err) {
    // Graceful fallback is already handled
  }
}

// Start initialization in background on import, unless in test environment
if (typeof process !== 'undefined' && !process.env.NODE_TEST_CONTEXT && process.env.NODE_ENV !== 'test') {
  initializeFormatter().catch(() => {});
}

marked.setOptions({
  renderer: new TerminalRenderer({
    heading: str => pc.bold(pc.cyan(str)),
    firstHeading: str => pc.bold(pc.magenta(str)),
    strong: str => pc.bold(str),
    em: str => pc.italic(str),
    codespan: str => pc.yellow(str),
    link: str => pc.blue(str),
    href: str => pc.blue(str),
    blockquote: str => pc.italic(pc.dim(str))
  })
});

export function printThinkingProcess(steps) {
  let thinkingText = '';
  
  for (const step of steps) {
    // Check old Vercel AI SDK step content format
    if (Array.isArray(step.content)) {
      for (const item of step.content) {
        if (item.type === 'reasoning') {
          thinkingText += item.text + '\n';
        }
      }
    }
    // Check ADK Event format
    else if (step.content && Array.isArray(step.content.parts)) {
      for (const part of step.content.parts) {
        if (part.thought) {
          thinkingText += (part.text || '') + '\n';
        }
      }
    }
  }

  thinkingText = thinkingText.trim();
  if (thinkingText) {
    console.log(pc.cyan(pc.bold('Thinking Process:')));
    thinkingText.split('\n').forEach(line => {
      console.log(pc.dim(pc.italic(`  ${line}`)));
    });
    console.log(); // Spacing after thinking process
  }
}

export function printBanner() {
  console.log(pc.magenta(pc.bold('┌────────────────────────────────────────────────────────┐')));
  console.log(pc.magenta(pc.bold('│')) + pc.bold(pc.cyan('   PLUMAR CLI                                           ')) + pc.magenta(pc.bold('│')));
  console.log(pc.magenta(pc.bold('│')) + pc.dim('   Your local AI engine for chat, coding & scripting    ') + pc.magenta(pc.bold('│')));
  console.log(pc.magenta(pc.bold('├────────────────────────────────────────────────────────┤')));
  console.log(pc.magenta(pc.bold('│')) + pc.dim('   Core Slash Commands:                                 ') + pc.magenta(pc.bold('│')));
  console.log(pc.magenta(pc.bold('│')) + '   ' + pc.yellow('/help') + '       Show command menu                        ' + pc.magenta(pc.bold('│')));
  console.log(pc.magenta(pc.bold('│')) + '   ' + pc.yellow('/features') + '   Show premium capabilities overview       ' + pc.magenta(pc.bold('│')));
  console.log(pc.magenta(pc.bold('│')) + '   ' + pc.yellow('/mode') + '       List & switch chat profiles/modes        ' + pc.magenta(pc.bold('│')));
  console.log(pc.magenta(pc.bold('│')) + '   ' + pc.yellow('/model') + '      Change active local Ollama model         ' + pc.magenta(pc.bold('│')));
  console.log(pc.magenta(pc.bold('│')) + '   ' + pc.yellow('/tools') + '      List enabled workspace tools             ' + pc.magenta(pc.bold('│')));
  console.log(pc.magenta(pc.bold('│')) + '   ' + pc.yellow('/samples') + '    Show sample prompts/commands for tools   ' + pc.magenta(pc.bold('│')));
  console.log(pc.magenta(pc.bold('│')) + '   ' + pc.yellow('/skills') + '     List custom agentic skills               ' + pc.magenta(pc.bold('│')));
  console.log(pc.magenta(pc.bold('│')) + '   ' + pc.yellow('/plugins') + '    List custom JS code plugins              ' + pc.magenta(pc.bold('│')));
  console.log(pc.magenta(pc.bold('│')) + '   ' + pc.yellow('/sessions') + '   Manage, load & delete stored sessions    ' + pc.magenta(pc.bold('│')));
  console.log(pc.magenta(pc.bold('│')) + '   ' + pc.yellow('/policy') + '     View or configure tool execution policies' + pc.magenta(pc.bold('│')));
  console.log(pc.magenta(pc.bold('│')) + '   ' + pc.yellow('/parameter') + '  View/configure active model parameters    ' + pc.magenta(pc.bold('│')));
  console.log(pc.magenta(pc.bold('│')) + '   ' + pc.yellow('/clear') + '      Clear screen & start clean session       ' + pc.magenta(pc.bold('│')));
  console.log(pc.magenta(pc.bold('│')) + '   ' + pc.yellow('/minimize') + '   Prune older history/reduce context size  ' + pc.magenta(pc.bold('│')));
  console.log(pc.magenta(pc.bold('│')) + '   ' + pc.yellow('/context') + '    Load & minimize folder files into context' + pc.magenta(pc.bold('│')));
  console.log(pc.magenta(pc.bold('│')) + '   ' + pc.yellow('/exit') + '       Quit terminal session                    ' + pc.magenta(pc.bold('│')));
  console.log(pc.magenta(pc.bold('└────────────────────────────────────────────────────────┘')));
  console.log();
}

export function printHelp(topic) {
  const normalized = topic ? topic.trim().toLowerCase() : '';

  if (normalized === 'piping' || normalized === 'pipe') {
    console.log(pc.bold(pc.yellow('\nPrompt Piping Help:')));
    console.log(`  You can execute a local shell command and automatically feed its output into your prompt.`);
    console.log(`  Syntax: ${pc.cyan('<your prompt text> | <shell command>')}`);
    console.log(`\n  ${pc.bold('Examples:')}`);
    console.log(`    • ${pc.cyan('explain this file | cat index.js')}`);
    console.log(`      Runs \`cat index.js\` locally and appends its contents to your prompt.`);
    console.log(`    • ${pc.cyan('summarize recent changes | git diff')}`);
    console.log(`      Runs \`git diff\` and appends the diff output to your prompt.`);
    console.log(`    • ${pc.cyan('why is my test failing | node --test tests/tools.test.js')}`);
    console.log(`      Runs tests and sends the output results directly to the agent.`);
    console.log(`\n  ${pc.dim('Note: Questions about the pipe character itself (e.g. ending in "?") are automatically ignored and not executed.')}\n`);
    return;
  }

  if (normalized === 'history' || normalized === 'search' || normalized === 'ctrl+r' || normalized === 'ctrl-r') {
    console.log(pc.bold(pc.yellow('\nCommand & Search History Help:')));
    console.log(`  ${pc.bold('1. History List')}`);
    console.log(`     Type ${pc.yellow('/history')} to display all unique prompts and commands entered in chronological order.`);
    console.log(`\n  ${pc.bold('2. Interactive Reverse i-Search')}`);
    console.log(`     Press ${pc.yellow('Ctrl+R')} at the prompt to search past history interactively.`);
    console.log(`     • ${pc.bold('Type characters')}: filters history matches immediately.`);
    console.log(`     • ${pc.bold('Press Ctrl+R again')}: cycles through matches matching your query.`);
    console.log(`     • ${pc.bold('Press Backspace')}: deletes characters from your search query.`);
    console.log(`     • ${pc.bold('Press Enter/Return')}: selects the active match and populates the input line.`);
    console.log(`     • ${pc.bold('Press Esc / Ctrl+C')}: cancels search and returns to normal typing.`);
    console.log();
    return;
  }

  console.log(pc.bold('\n📝 Available Chat Commands:'));
  console.log(`  ${pc.yellow('/help')}         - Display this detailed help menu.`);
  console.log(`  ${pc.yellow('/help piping')}  - Learn how to execute shell commands and pipe their output into prompts.`);
  console.log(`  ${pc.yellow('/help history')} - Learn how to view history and use interactive Ctrl+R search.`);
  console.log(`  ${pc.yellow('/features')}     - Display a detailed overview of premium Plumar features.`);
  console.log(`  ${pc.yellow('/mode')}         - List and switch between agent chat modes.`);
  console.log(`  ${pc.yellow('/mode <name>')}  - Switch directly to a mode (e.g. /mode code).`);
  console.log(`  ${pc.yellow('/model')}        - Interactively switch active Ollama model.`);
  console.log(`  ${pc.yellow('/host')}         - Display or dynamically switch Ollama server host.`);
  console.log(`  ${pc.yellow('/parameter')}    - View, list, or set active model parameters on-the-fly.`);
  console.log(`  ${pc.yellow('/tools')}        - List all file system & system utilities currently loaded.`);
  console.log(`  ${pc.yellow('/samples')}      - Show sample commands/prompts for every tool.`);
  console.log(`  ${pc.yellow('/skills')}       - List all loaded custom skills.`);
  console.log(`  ${pc.yellow('/add-skill')}    - Interactive wizard to create and register a new custom skill.`);
  console.log(`  ${pc.yellow('/plugins')}      - List all loaded custom JavaScript code plugins.`);
  console.log(`  ${pc.yellow('/add-plugin')}   - Interactive wizard to create and register a new JS plugin.`);
  console.log(`  ${pc.yellow('/sessions')}     - Open interactive dashboard to manage and fetch saved sessions.`);
  console.log(`  ${pc.yellow('/minimize')}     - Prune older conversation history to reduce active context size.`);
  console.log(`  ${pc.yellow('/context')}      - Scan current folder and place a minimized local files index in the active context.`);
  console.log(`  ${pc.yellow('/history')}       - Display command and prompt history list.`);
  console.log(`  ${pc.yellow('/info')}         - Display current session diagnostics.`);
  console.log(`  ${pc.yellow('/verbose')}      - Toggle verbose JSON payload logging (disabled by default).`);
  console.log(`  ${pc.yellow('/adk-info')}     - Toggle ADK internal event logging (disabled by default).`);
  console.log(`  ${pc.yellow('/policy')}       - View or configure allow/ask/deny execution rules for tools.`);
  console.log(`  ${pc.yellow('/settings')}     - View or dynamically switch settings (e.g. Ollama Endpoint).`);
  console.log(`  ${pc.yellow('/clear')}        - Clear terminal console and wipe conversation history.`);
  console.log(`  ${pc.yellow('/exit')} or ${pc.yellow('/quit')} - Safely terminate the CLI application.`);
  console.log(`  ${pc.yellow('Ctrl+R')}        - Interactive reverse-i-search in command and prompt history.\n`);
}

export function printTools(toolsList) {
  console.log(pc.bold(pc.yellow('\n🛠️  Equipped Agent Tools:')));
  Object.entries(toolsList).forEach(([name, toolObj]) => {
    console.log(`  • ${pc.bold(pc.magenta(name))}: ${toolObj.description}`);
  });
  console.log();
}

export function printToolCall(toolName, args) {
  const argsStr = Object.keys(args).length ? JSON.stringify(args) : 'no arguments';
  console.log(pc.yellow(`🛠️  [Agent Tool Call] `) + pc.dim('Executing ') + pc.bold(pc.yellow(toolName)) + pc.dim(` with `) + pc.italic(argsStr));
}

export function flattenObject(obj, prefix = '') {
  let result = {};
  if (obj === null || typeof obj !== 'object') {
    return result;
  }
  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix} › ${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value, newKey));
    } else if (Array.isArray(value)) {
      result[newKey] = JSON.stringify(value);
    } else {
      result[newKey] = value;
    }
  }
  return result;
}

/**
 * Formats a JSON object or array as a beautiful aligned box-drawing ASCII/ANSI table.
 */
export function formatJsonAsTable(obj) {
  if (obj === null || typeof obj !== 'object') {
    return String(obj);
  }

  // Handle arrays of objects
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    // Check if it's an array of objects
    const firstItem = obj[0];
    if (firstItem && typeof firstItem === 'object' && !Array.isArray(firstItem)) {
      const keys = [...new Set(obj.flatMap(item => Object.keys(item || {})))];
      if (keys.length > 0) {
        const colWidths = {};
        for (const key of keys) {
          colWidths[key] = key.length;
        }
        for (const item of obj) {
          for (const key of keys) {
            const valStr = item && item[key] !== undefined ? String(item[key]) : '';
            if (valStr.length > colWidths[key]) {
              colWidths[key] = valStr.length;
            }
          }
        }
        
        let outputLines = [];
        const topBorderParts = keys.map(k => '─'.repeat(colWidths[k] + 2));
        outputLines.push(pc.bold(pc.cyan('┌' + topBorderParts.join('┬') + '┐')));
        
        const headerParts = keys.map(k => pc.bold(k.padEnd(colWidths[k])));
        outputLines.push(pc.bold(pc.cyan('│ ')) + headerParts.join(pc.bold(pc.cyan(' │ '))) + pc.bold(pc.cyan(' │')));
        
        const middleBorderParts = keys.map(k => '─'.repeat(colWidths[k] + 2));
        outputLines.push(pc.bold(pc.cyan('├' + middleBorderParts.join('┼') + '┤')));
        
        for (const item of obj) {
          const rowParts = keys.map(k => {
            const val = item && item[k] !== undefined ? String(item[k]) : '';
            return pc.magenta(val.padEnd(colWidths[k]));
          });
          outputLines.push(pc.bold(pc.cyan('│ ')) + rowParts.join(pc.bold(pc.cyan(' │ '))) + pc.bold(pc.cyan(' │')));
        }
        
        const bottomBorderParts = keys.map(k => '─'.repeat(colWidths[k] + 2));
        outputLines.push(pc.bold(pc.cyan('└' + bottomBorderParts.join('┴') + '┘')));
        
        return '\n' + outputLines.join('\n');
      }
    }
    return JSON.stringify(obj, null, 2);
  }

  // Handle standard objects (key-value pairs)
  const flattened = flattenObject(obj);
  const entries = Object.entries(flattened);
  if (entries.length === 0) return '{}';

  let maxLabelWidth = 0;
  let maxValueWidth = 0;
  
  const settings = entries.map(([key, val]) => {
    let valStr = '';
    if (typeof val === 'object' && val !== null) {
      valStr = JSON.stringify(val);
    } else {
      valStr = String(val);
    }
    const labelLen = key.length;
    const valueLen = valStr.length;
    if (labelLen > maxLabelWidth) maxLabelWidth = labelLen;
    if (valueLen > maxValueWidth) maxValueWidth = valueLen;
    return { label: key, value: valStr };
  });

  if (maxLabelWidth < 10) maxLabelWidth = 10;
  if (maxValueWidth < 10) maxValueWidth = 10;

  // Cap value column width to prevent overflow
  const cappedValueWidth = maxValueWidth > 60 ? 60 : maxValueWidth;

  const topBorder = pc.bold(pc.cyan('┌' + '─'.repeat(maxLabelWidth + 2) + '┬' + '─'.repeat(cappedValueWidth + 2) + '┐'));
  const bottomBorder = pc.bold(pc.cyan('└' + '─'.repeat(maxLabelWidth + 2) + '┴' + '─'.repeat(cappedValueWidth + 2) + '┘'));

  let outputLines = [];
  outputLines.push(topBorder);

  for (const item of settings) {
    let displayValue = item.value;
    if (displayValue.length > cappedValueWidth) {
      displayValue = displayValue.slice(0, cappedValueWidth - 3) + '...';
    }
    const paddedLabel = item.label.padEnd(maxLabelWidth);
    const paddedValue = displayValue.padEnd(cappedValueWidth);
    const coloredLabel = pc.bold(paddedLabel);
    const coloredValue = pc.magenta(paddedValue);
    outputLines.push(pc.bold(pc.cyan('│ ')) + coloredLabel + pc.bold(pc.cyan(' │ ')) + coloredValue + pc.bold(pc.cyan(' │')));
  }
  outputLines.push(bottomBorder);

  return '\n' + outputLines.join('\n');
}

/**
 * Parses and replaces standard Markdown pipe tables (| Col |) with premium cyan box-drawing tables.
 */
export function formatMarkdownTables(text, tableFormatter = formatJsonAsTable) {
  if (!text) return '';
  const lines = text.split('\n');
  let inTable = false;
  let tableLines = [];
  const processedLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const isTableLine = trimmed.startsWith('|') && trimmed.endsWith('|');

    if (isTableLine) {
      if (!inTable) {
        inTable = true;
        tableLines = [line];
      } else {
        tableLines.push(line);
      }
    } else {
      if (inTable) {
        processedLines.push(processMarkdownTableLines(tableLines, tableFormatter));
        inTable = false;
        tableLines = [];
      }
      processedLines.push(line);
    }
  }

  if (inTable) {
    processedLines.push(processMarkdownTableLines(tableLines, tableFormatter));
  }

  return processedLines.join('\n');
}

function processMarkdownTableLines(lines, tableFormatter = formatJsonAsTable) {
  if (lines.length < 3) return lines.join('\n');

  // Replace escaped pipes \| to prevent split issues, then split and restore them
  const headers = lines[0]
    .replace(/\\\|/g, '__ESCAPED_PIPE__')
    .split('|')
    .slice(1, -1)
    .map(h => h.replace(/__ESCAPED_PIPE__/g, '|').trim());

  const separatorCells = lines[1]
    .replace(/\\\|/g, '__ESCAPED_PIPE__')
    .split('|')
    .slice(1, -1)
    .map(s => s.replace(/__ESCAPED_PIPE__/g, '|').trim());

  const isSeparator = separatorCells.length === headers.length && separatorCells.every(s => /^\s*:?-+:?\s*$/.test(s));
  if (!isSeparator) return lines.join('\n');

  const rows = [];
  for (let i = 2; i < lines.length; i++) {
    const rowCells = lines[i]
      .replace(/\\\|/g, '__ESCAPED_PIPE__')
      .split('|')
      .slice(1, -1)
      .map(c => c.replace(/__ESCAPED_PIPE__/g, '|').trim());

    while (rowCells.length < headers.length) {
      rowCells.push('');
    }
    rows.push(rowCells.slice(0, headers.length));
  }

  const objArray = rows.map(row => {
    const obj = {};
    headers.forEach((h, index) => {
      obj[h] = row[index];
    });
    return obj;
  });

  return tableFormatter(objArray).trim();
}

/**
 * Formats JSON structures in a chat response text as tables.
 * This can be the entire text or a JSON block inside the text.
 */
export function formatChatResponse(text) {
  if (!text) return '';

  const trimmed = text.trim();

  // 1. Check if the entire response is a JSON code block: ```json ... ``` or ``` ... ```
  const entireCodeBlockRegex = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;
  const entireCodeBlockMatch = trimmed.match(entireCodeBlockRegex);
  if (entireCodeBlockMatch) {
    const innerText = entireCodeBlockMatch[1].trim();
    if ((innerText.startsWith('{') && innerText.endsWith('}')) || (innerText.startsWith('[') && innerText.endsWith(']'))) {
      try {
        const parsed = JSON.parse(innerText);
        return formatJsonAsTable(parsed);
      } catch (e) {
        // Fall back
      }
    }
  }

  // 2. Check if the entire response itself is raw JSON
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      const parsed = JSON.parse(trimmed);
      return formatJsonAsTable(parsed);
    } catch (e) {
      // Fall back
    }
  }

  // 3. Find and replace any JSON code blocks inside the text
  const tables = [];
  const addTablePlaceholder = (tableText) => {
    const placeholder = `TABLEPLACEHOLDER${tables.length}`;
    tables.push(tableText);
    return `\n\n${placeholder}\n\n`;
  };

  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  let hasReplacement = false;
  const replacedText = text.replace(codeBlockRegex, (match, codeContent) => {
    const trimmedCode = codeContent.trim();
    if ((trimmedCode.startsWith('{') && trimmedCode.endsWith('}')) || (trimmedCode.startsWith('[') && trimmedCode.endsWith(']'))) {
      try {
        const parsed = JSON.parse(trimmedCode);
        hasReplacement = true;
        const tableText = formatJsonAsTable(parsed);
        return addTablePlaceholder(tableText);
      } catch (e) {
        return match;
      }
    }
    return match;
  });

  let tableFormattedText;
  if (hasReplacement) {
    tableFormattedText = formatMarkdownTables(replacedText, (objArray) => {
      const tableText = formatJsonAsTable(objArray);
      return addTablePlaceholder(tableText);
    });
  } else {
    tableFormattedText = formatMarkdownTables(text, (objArray) => {
      const tableText = formatJsonAsTable(objArray);
      return addTablePlaceholder(tableText);
    });
  }

  let renderedText;
  if (lipInstance) {
    try {
      renderedText = lipInstance.RenderMD(tableFormattedText, "dark").trim();
    } catch (err) {
      // Fallback to marked
    }
  }

  if (!renderedText) {
    try {
      renderedText = marked(tableFormattedText).trim();
    } catch (err) {
      renderedText = tableFormattedText;
    }
  }

  // Restore placeholders with original formatted tables
  for (let i = 0; i < tables.length; i++) {
    const placeholder = `TABLEPLACEHOLDER${i}`;
    renderedText = renderedText.replace(placeholder, tables[i]);
  }

  return renderedText;
}

export function printToolResult(toolName, result) {
  let statusStr = result.success !== false ? pc.green('Success') : pc.red('Failed');
  console.log(pc.blue(`📦 [Agent Tool Result] `) + pc.bold(pc.blue(toolName)) + ` completed with ` + statusStr);
  if (result.success === false) {
    if (typeof result === 'object' && result !== null) {
      console.log(pc.red(`   Error: ${result.error || 'Failed'}`));
      console.log(formatJsonAsTable(result));
    } else {
      console.log(pc.red(`   Error: ${result}`));
    }
  } else {
    if (typeof result === 'object' && result !== null) {
      console.log(formatJsonAsTable(result));
    } else {
      console.log(pc.dim(`   Result: ${result}`));
    }
  }
}

export function printStatus(model, mode, modeMeta, temperature = null) {
  const tempStr = temperature !== null ? ` (temp: ${temperature})` : '';
  const modelDisplay = (model + tempStr).padEnd(38);
  const modeDisplay = (modeMeta.emoji ? (modeMeta.emoji + ' ' + modeMeta.name) : modeMeta.name).padEnd(38);
  console.log(pc.bold(pc.cyan('┌────────────────────────────────────────────────────────┐')));
  console.log(pc.bold(pc.cyan('│')) + `  ${pc.bold('Active Model:')}  ${pc.magenta(modelDisplay)} ${pc.bold(pc.cyan('│'))}`);
  console.log(pc.bold(pc.cyan('│')) + `  ${pc.bold('Active Mode:')}   ${modeDisplay} ${pc.bold(pc.cyan('│'))}`);
  console.log(pc.bold(pc.cyan('└────────────────────────────────────────────────────────┘')));
  console.log();
}

export function printModes(chatModes, activeMode) {
  console.log(pc.bold(pc.yellow('\nAvailable Chat Modes:')));
  Object.entries(chatModes).forEach(([key, meta]) => {
    const isSelected = key === activeMode;
    const bullet = isSelected ? pc.bold(pc.green('❯')) : ' ';
    const keyName = isSelected ? pc.bold(pc.green(key)) : pc.dim(key);
    const details = `${meta.emoji} ${pc.bold(meta.name)} - ${meta.description}`;
    console.log(`  ${bullet} [${keyName}] ${details}`);
  });
  console.log(pc.dim('  Note: You can customize or add custom chat modes in ./.plumar/settings.json\n'));
}

function hasNativeToolSupport(model) {
  if (!model) return false;
  const name = (model.name || '').toLowerCase();
  const family = (model.details?.family || '').toLowerCase();
  const families = Array.isArray(model.details?.families)
    ? model.details.families.map(f => String(f).toLowerCase())
    : [];

  const knownFamilies = [
    'llama', 'mistral', 'mixtral', 'qwen', 'qwen2', 'command-r', 
    'cohere', 'nemotron', 'granite', 'firefunction', 'phi4'
  ];

  if (knownFamilies.includes(family)) {
    return true;
  }
  for (const f of families) {
    if (knownFamilies.includes(f)) {
      return true;
    }
  }

  const knownNameKeywords = [
    'llama3', 'llama-3', 'mistral', 'mixtral', 'qwen2', 'qwen-2', 
    'command-r', 'nemotron', 'granite', 'firefunction', 'phi-4'
  ];
  for (const kw of knownNameKeywords) {
    if (name.includes(kw)) {
      return true;
    }
  }

  return false;
}

export function printModelSelection(models, currentModel) {
  console.log(pc.bold(pc.yellow('\nAvailable Ollama Models:')));
  models.forEach((model, index) => {
    const isObj = typeof model === 'object' && model !== null;
    const modelName = isObj ? model.name : model;
    const isSelected = modelName === currentModel;
    const bullet = isSelected ? pc.bold(pc.green('❯')) : ' ';
    const num = pc.cyan(`[${index + 1}]`);
    const name = isSelected ? pc.bold(pc.green(modelName)) : modelName;

    let extraInfo = '';
    if (isObj) {
      const charParts = [];
      if (model.details?.family) {
        charParts.push(model.details.family);
      }
      if (model.details?.parameter_size) {
        charParts.push(model.details.parameter_size);
      }
      if (model.details?.quantization_level) {
        charParts.push(model.details.quantization_level);
      }
      if (model.size) {
        const gb = model.size / (1024 * 1024 * 1024);
        const mb = model.size / (1024 * 1024);
        const sizeStr = gb >= 1 ? `${gb.toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
        charParts.push(sizeStr);
      }
      
      const nativeTools = hasNativeToolSupport(model);
      charParts.push(nativeTools ? 'Tools: Native' : 'Tools: Text Fallback');

      if (charParts.length > 0) {
        extraInfo = pc.dim(` (${charParts.join(', ')})`);
      }
    }

    console.log(`  ${bullet} ${num} ${name}${extraInfo}`);
  });
  console.log();
}

export function printSkills(skillsMap) {
  console.log(pc.bold(pc.yellow('\nLoaded Custom Skills:')));
  const entries = Object.entries(skillsMap);
  if (entries.length === 0) {
    console.log(pc.dim('  No custom skills currently loaded. Create one with /add-skill.'));
  } else {
    entries.forEach(([name, skill]) => {
      console.log(`  • ${pc.bold(pc.magenta(name))}: ${skill.frontmatter.description}`);
      if (skill.frontmatter.tags) {
        console.log(`    ${pc.dim('Tags:')} ${pc.italic(skill.frontmatter.tags)}`);
      }
    });
  }
  console.log();
}

export function printPlugins(pluginsMap) {
  console.log(pc.bold(pc.yellow('\nLoaded Code Plugins:')));
  const entries = Object.entries(pluginsMap);
  if (entries.length === 0) {
    console.log(pc.dim('  No code plugins currently loaded. Create one with /add-plugin.'));
  } else {
    entries.forEach(([fileName, pluginInfo]) => {
      console.log(`  • ${pc.bold(pc.cyan(fileName))}`);
      pluginInfo.tools.forEach(tool => {
        console.log(`    - ${pc.bold(pc.magenta(tool.name))}: ${tool.description}`);
      });
    });
  }
  console.log();
}


const TOOL_SAMPLES = {
  calculator: {
    prompt: "Calculate 25 * (144 / 12)",
    toolCall: "calculator({ expression: '25 * (144 / 12)' })"
  },
  getSystemInfo: {
    prompt: "Show my system hardware and memory stats",
    toolCall: "getSystemInfo({})"
  },
  getCurrentTime: {
    prompt: "What is the current time and timezone?",
    toolCall: "getCurrentTime({})"
  },
  listFiles: {
    prompt: "List all files in the current folder",
    toolCall: "listFiles({ directory: '.' })"
  },
  readFile: {
    prompt: "Read the contents of package.json",
    toolCall: "readFile({ filePath: 'package.json' })"
  },
  writeFile: {
    prompt: "Write 'Hello World' to hello.txt",
    toolCall: "writeFile({ filePath: 'hello.txt', CodeContent: 'Hello World', Overwrite: true })"
  },
  fetchWebPage: {
    prompt: "Fetch the content of https://example.com",
    toolCall: "fetchWebPage({ Url: 'https://example.com' })"
  },
  appendFile: {
    prompt: "Append 'new line' to logs.txt",
    toolCall: "appendFile({ filePath: 'logs.txt', content: 'new line\\n' })"
  },
  deleteFile: {
    prompt: "Delete temp.txt",
    toolCall: "deleteFile({ filePath: 'temp.txt' })"
  },
  makeDirectory: {
    prompt: "Create a folder named src/utils",
    toolCall: "makeDirectory({ directoryPath: 'src/utils' })"
  },
  searchGrep: {
    prompt: "Find all occurrences of 'TODO' in my codebase",
    toolCall: "searchGrep({ Query: 'TODO', SearchPath: '.', CaseInsensitive: true })"
  },
  writeMarkdown: {
    prompt: "Create a structured README.md with features and setup sections",
    toolCall: "writeMarkdown({ filePath: 'README.md', title: 'My Project', sections: [{ heading: 'Features', body: '- Easy to use\\n- Fast' }] })"
  },
  executeCommand: {
    prompt: "Run 'npm run build' in the terminal",
    toolCall: "executeCommand({ command: 'npm run build' })"
  },
  searchReplace: {
    prompt: "Replace 'old_value' with 'new_value' in config.json",
    toolCall: "searchReplace({ filePath: 'config.json', findText: 'old_value', replaceText: 'new_value' })"
  },
  findFiles: {
    prompt: "Find all files matching *.test.js",
    toolCall: "findFiles({ pattern: '*.test.js', directory: '.' })"
  },
  dinoGame: {
    prompt: "Start the Dino Game",
    toolCall: "dinoGame({ action: 'start' })"
  },
  apiPerformanceTest: {
    prompt: "Run a load test of 50 requests with concurrency of 5 on http://localhost:3000/api/health",
    toolCall: "apiPerformanceTest({ url: 'http://localhost:3000/api/health', requests: 50, concurrency: 5 })"
  },
  createAsciiArt: {
    prompt: "Create an ASCII art of a rocket with slant font",
    toolCall: "createAsciiArt({ text: 'rocket', font: 'slant', presetShape: 'rocket' })"
  },
  fetchImage: {
    prompt: "Download the image from https://example.com/logo.png to ./logo.png",
    toolCall: "fetchImage({ url: 'https://example.com/logo.png', outputPath: './logo.png' })"
  },
  base64Convert: {
    prompt: "Encode 'secret' to base64",
    toolCall: "base64Convert({ action: 'encode', data: 'secret' })"
  },
  generateMockData: {
    prompt: "Generate 5 rows of mock users with email, name, and age as JSON",
    toolCall: "generateMockData({ format: 'json', count: 5, fields: [{ name: 'name', type: 'fullName' }, { name: 'email', type: 'email' }] })"
  },
  generateHash: {
    prompt: "Calculate SHA-256 hash of password.txt",
    toolCall: "generateHash({ algorithm: 'sha256', filePath: 'password.txt' })"
  },
  listSkills: {
    prompt: "List all loaded skills",
    toolCall: "listSkills({})"
  },
  loadSkill: {
    prompt: "Load the code-architect skill",
    toolCall: "loadSkill({ name: 'code-architect' })"
  },
  createSkill: {
    prompt: "Create a skill called react-helper with instructions...",
    toolCall: "createSkill({ name: 'react-helper', description: 'React helper skill', instructions: 'Instructions here...' })"
  },
  createPlugin: {
    prompt: "Create a plugin called git-helper with instructions...",
    toolCall: "createPlugin({ name: 'git-helper', description: 'Git helper', code: 'Code here...' })"
  }
};

export function printSamples(toolsList) {
  console.log(pc.bold(pc.yellow('\nTool Sample Commands & Prompts:')));
  const entries = Object.keys(toolsList);
  if (entries.length === 0) {
    console.log(pc.dim('  No tools currently loaded.'));
  } else {
    entries.forEach((name) => {
      const sample = TOOL_SAMPLES[name] || {
        prompt: `Use the ${name} tool to accomplish your task`,
        toolCall: `${name}({ ... })`
      };
      console.log(`  • ${pc.bold(pc.magenta(name))}:`);
      console.log(`    ${pc.cyan('Prompt Example:')}  "${sample.prompt}"`);
      console.log(`    ${pc.dim('Tool Call:')}      ${pc.italic(sample.toolCall)}`);
    });
  }
  console.log();
}

export function printFeatures() {
  console.log(pc.bold(pc.magenta('\nPlumar Premium Features & Capabilities:')));
  
  console.log(`\n  ${pc.bold(pc.cyan('Interactive Plumar Dino Game'))}`);
  console.log(`     • ${pc.dim('Launch a full retro-neon 8-bit themed Dino game right in your browser via')} ${pc.yellow('/dino-game')}${pc.dim('.')}`);
  console.log(`     • ${pc.dim('Includes standard and low-G physics, real-time ceiling running (gravity flip via')} ${pc.yellow('Shift')}/${pc.yellow('F')}${pc.dim('),')}`);
  console.log(`       ${pc.dim('persisted local-storage high score keeping, and nostalgia-inducing synthesized 8-bit audio FX.')}`);

  console.log(`\n  ${pc.bold(pc.cyan('Advanced Developer Utilities'))}`);
  console.log(`     • ${pc.magenta('Zero-Dependency Database Explorer')} - ${pc.dim('Direct schema exploration, table inspection, and SQL querying')}`);
  console.log(`       ${pc.dim('capabilities for PostgreSQL & MySQL databases using custom, robust CLI pipelines.')}`);
  console.log(`     • ${pc.magenta('Port Manager')} - ${pc.dim('Instantly identify and terminate process blocks on any active network port (PID/Port).')}`);
  console.log(`     • ${pc.magenta('REST Client & Performance Load Tester')} - ${pc.dim('Construct HTTP API requests and execute concurrent load testing')}`);
  console.log(`       ${pc.dim('with full latency statistics (Min, Max, Avg, P95, P99) and successful request ratios.')}`);
  console.log(`     • ${pc.magenta('Git Helper')} - ${pc.dim('Retrieve repository status, rich log history, file-level diff summaries, and automatically')}`);
  console.log(`       ${pc.dim('draft intelligent commit messages from staged repository changes.')}`);
  console.log(`     • ${pc.magenta('Code Formatter & ES Linter')} - ${pc.dim('Keep your workspace neat with automated code formatter & linter integrations.')}`);
  console.log(`     • ${pc.magenta('Dependency Scanner')} - ${pc.dim('Detect unused/undeclared imports, outdated library versions, or audit vulnerabilities.')}`);

  console.log(`\n  ${pc.bold(pc.cyan('Custom Sandbox & Fine-Grained Safety Policies'))}`);
  console.log(`     • ${pc.dim('Configure specific permission rules (')}ALLOW, ASK, or DENY${pc.dim(') for each tool using')} ${pc.yellow('/policy')}${pc.dim('.')}`);
  console.log(`     • ${pc.dim('Persistent configuration can be loaded or saved across sessions using')} ${pc.yellow('/policy config <file>')}${pc.dim('.')}`);

  console.log(`\n  ${pc.bold(pc.cyan('Interactive Session Persistence & REPL Navigation'))}`);
  console.log(`     • ${pc.dim('Complete session management dashboard via')} ${pc.yellow('/sessions')} ${pc.dim('allowing you to load, store, or clear conversations.')}`);
  console.log(`     • ${pc.dim('Run interactive reverse history searching via')} ${pc.yellow('Ctrl+R')} ${pc.dim('or view past entries sequentially with')} ${pc.yellow('/history')}${pc.dim('.')}`);
  console.log(`     • ${pc.dim('Support for command piping (')}prompt | <shell command>${pc.dim(') to seamlessly inject dynamic output from standard tools.')}`);

  console.log(`\n  ${pc.bold(pc.cyan('Model Context Protocol (MCP) Integration'))}`);
  console.log(`     • ${pc.dim('Standard-compliant MCP host server client manager to dynamically plug in extra external tools and APIs')}`);
  console.log(`       ${pc.dim('defined in')} ${pc.blue('mcp-servers.json')}${pc.dim('.')}`);
  console.log();
}
