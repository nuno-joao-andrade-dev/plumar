import { BaseLlm, FileArtifactService } from '@google/adk';
import path from 'node:path';
import fs from 'node:fs';
import { 
  getOllamaBaseUrl, 
  getOllamaHeaders, 
  getModelContextLength,
  getModelDetails,
  isVerboseJsonEnabled,
  getLlmProvider,
  isExecuteThinkingEnabled
} from './agent-config.js';
import { addSessionTokens } from './token-tracker.js';
import { tools } from './policy-manager.js';

// Sequential helper to convert ADK contents (and systems prompt) to Ollama/OpenAI messages
export function adkContentsToOllamaMessages(contents, systemInstruction) {
  const messages = [];
  
  if (systemInstruction) {
    messages.push({
      role: 'system',
      content: systemInstruction
    });
  }
  
  const toolCallMap = new Map();
  let callCounter = 0;
  
  for (const content of contents) {
    const role = content.role === 'model' ? 'assistant' : 'user';
    const parts = content.parts || [];
    
    const hasFunctionCall = parts.some(p => p.functionCall);
    const hasFunctionResponse = parts.some(p => p.functionResponse);
    
    if (hasFunctionCall) {
      const toolCalls = [];
      let textContent = '';
      let thoughtContent = '';
      
      for (const part of parts) {
        if (part.thought && part.text) {
          thoughtContent += `<thinking>\n${part.text.trim()}\n</thinking>\n`;
        } else if (part.text) {
          textContent += part.text;
        }
        if (part.functionCall) {
          callCounter++;
          const callId = part.functionCall.id || `call_${part.functionCall.name}_${callCounter}`;
          const queue = toolCallMap.get(part.functionCall.name) || [];
          queue.push(callId);
          toolCallMap.set(part.functionCall.name, queue);
          toolCalls.push({
            id: callId,
            type: 'function',
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args || {}),
            }
          });
        }
      }
      
      const fullContent = (thoughtContent + textContent).trim();
      messages.push({
        role: 'assistant',
        content: fullContent || '',
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined
      });
    } else if (hasFunctionResponse) {
      for (const part of parts) {
        if (part.functionResponse) {
          const name = part.functionResponse.name;
          const queue = toolCallMap.get(name);
          let callId = part.functionResponse.id || (queue && queue.length > 0 ? queue.shift() : null);
          if (!callId) {
            callCounter++;
            callId = `call_${name}_${callCounter}`;
          }
          
          let responseObj = part.functionResponse.response ?? {};
          if (responseObj && typeof responseObj === 'object') {
            try {
              responseObj = JSON.parse(JSON.stringify(responseObj));
              const sanitizeAndTruncate = (obj) => {
                for (const key of Object.keys(obj)) {
                  if (typeof obj[key] === 'string') {
                    // Strip ANSI escape codes to prevent tokenizer/prompt corruption in local Ollama
                    let sanitized = obj[key].replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
                    const isCommandContentField = ['content', 'context', 'formattedContext', 'output', 'stdout', 'initialLogs', 'logs'].includes(key);
                    const maxLen = isCommandContentField ? 12000 : 4000;
                    if (sanitized.length > maxLen) {
                      const sliceLen = isCommandContentField ? 2500 : 1000;
                      obj[key] = sanitized.slice(0, sliceLen) + 
                                 `\n\n... [TRUNCATED ${sanitized.length - (sliceLen * 2)} characters to protect local Ollama context window, full output printed directly in terminal above] ...\n\n` + 
                                 sanitized.slice(-sliceLen);
                    } else {
                      obj[key] = sanitized;
                    }
                  } else if (obj[key] && typeof obj[key] === 'object') {
                    sanitizeAndTruncate(obj[key]);
                  }
                }
              };
              sanitizeAndTruncate(responseObj);
            } catch (e) {
              responseObj = part.functionResponse.response ?? {};
            }
          }
          
          messages.push({
            role: 'tool',
            tool_call_id: callId,
            name: name,
            content: JSON.stringify(responseObj),
          });
        }
      }
    } else {
      let textContent = '';
      let thoughtContent = '';
      for (const part of parts) {
        if (part.thought && part.text) {
          thoughtContent += `<thinking>\n${part.text.trim()}\n</thinking>\n`;
        } else if (part.text) {
          textContent += part.text;
        }
      }
      
      const fullContent = (thoughtContent + textContent).trim();
      messages.push({
        role,
        content: fullContent
      });
    }
  }
  
  // Merge consecutive same-role messages (excluding 'tool' role) to guarantee strict alternating compliance
  const mergedMessages = [];
  for (const msg of messages) {
    if (mergedMessages.length > 0 && mergedMessages[mergedMessages.length - 1].role === msg.role && msg.role !== 'tool') {
      const lastMsg = mergedMessages[mergedMessages.length - 1];
      
      // Merge content
      if (msg.content) {
        lastMsg.content = ((lastMsg.content || '') + '\n\n' + msg.content).trim();
      }
      
      // Combine tool_calls if present
      if (msg.tool_calls) {
        lastMsg.tool_calls = [...(lastMsg.tool_calls || []), ...msg.tool_calls];
      }
    } else {
      mergedMessages.push({ ...msg });
    }
  }
  
  return mergedMessages;
}

// Helper to recursively normalize schema type strings to lowercase (e.g. OBJECT -> object)
export function normalizeOllamaSchema(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map(normalizeOllamaSchema);
  }
  const copy = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'type' && typeof value === 'string') {
      copy[key] = value.toLowerCase();
    } else if (typeof value === 'object') {
      copy[key] = normalizeOllamaSchema(value);
    } else {
      copy[key] = value;
    }
  }
  return copy;
}

// Convert ADK config tools to Ollama/OpenAI tool schemas
export function adkToolsToOllamaTools(adkTools) {
  if (!adkTools || adkTools.length === 0) return undefined;
  
  const ollamaTools = [];
  for (const tool of adkTools) {
    if (tool.functionDeclarations) {
      for (const decl of tool.functionDeclarations) {
        const normalizedParams = decl.parameters ? normalizeOllamaSchema(decl.parameters) : { type: 'object', properties: {} };
        ollamaTools.push({
          type: 'function',
          function: {
            name: decl.name,
            description: decl.description,
            parameters: normalizedParams
          }
        });
      }
    }
  }
  return ollamaTools.length > 0 ? ollamaTools : undefined;
}

// Helper to parse standard and relaxed JS-object-like/JSON strings (e.g. from Gemma 4 <|tool_call> or LMStudio)
export function parseRelaxedJson(str) {
  if (!str || typeof str !== 'string') return {};
  str = str.trim();
  if (!str) return {};

  try {
    return JSON.parse(str);
  } catch (e) {
    // Standard parsing failed; try to repair relaxed JSON
  }

  const stringLiterals = [];
  let repaired = str;

  // 1. Extract Gemma 4 <|"|>...<|"|> delimited string literals first (supports multi-line code and unescaped quotes inside)
  if (repaired.includes('<|"|>')) {
    repaired = repaired.replace(/<\|"\|>([\s\S]*?)<\|"\|>/g, (_, inner) => {
      const idx = stringLiterals.length;
      stringLiterals.push(JSON.stringify(inner));
      return `"__PLUMAR_STR_${idx}__"`;
    });
  } else {
    // Protect existing double-quoted and single-quoted string literals with placeholders before quoting keys
    repaired = repaired.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (match) => {
      const idx = stringLiterals.length;
      if (match.startsWith("'")) {
        const inner = match.slice(1, -1).replace(/\\'/g, "'");
        stringLiterals.push(JSON.stringify(inner));
      } else {
        stringLiterals.push(match);
      }
      return `"__PLUMAR_STR_${idx}__"`;
    });
  }

  // 2. Quote unquoted keys (letters, numbers, underscore, dash, dot followed by a colon)
  repaired = repaired.replace(/([{,]\s*)([a-zA-Z0-9_.-]+)\s*:/g, '$1"$2":');
  // Remove trailing commas before closing brace/bracket
  repaired = repaired.replace(/,\s*([}\]])/g, '$1');

  // 3. Restore string literal placeholders
  repaired = repaired.replace(/"__PLUMAR_STR_(\d+)__"/g, (_, idxStr) => {
    return stringLiterals[Number(idxStr)];
  });

  try {
    return JSON.parse(repaired);
  } catch (e2) {
    // Last-resort regex-based key-value extractor for basic or truncated arguments
    const obj = {};
    const kvRegex = /([a-zA-Z0-9_.-]+)\s*:\s*(<\|"\|>[\s\S]*?<\|"\|>|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[0-9.]+|true|false|null)/g;
    let kvMatch;
    while ((kvMatch = kvRegex.exec(str)) !== null) {
      const key = kvMatch[1];
      let valStr = kvMatch[2].trim();
      let val;
      if (valStr.startsWith('<|"|>') && valStr.endsWith('<|"|>')) {
        val = valStr.slice(5, -5);
      } else if (valStr.startsWith('"') && valStr.endsWith('"')) {
        val = valStr.slice(1, -1);
      } else if (valStr.startsWith("'") && valStr.endsWith("'")) {
        val = valStr.slice(1, -1);
      } else if (valStr === 'true') {
        val = true;
      } else if (valStr === 'false') {
        val = false;
      } else if (valStr === 'null') {
        val = null;
      } else {
        val = Number(valStr);
        if (isNaN(val)) {
          val = valStr;
        }
      }
      obj[key] = val;
    }
    if (Object.keys(obj).length > 0) {
      return obj;
    }
    throw e2;
  }
}

/**
 * Parses XML-style parameter tags inside <function=...> or <tool_call> bodies,
 * e.g. <parameter=filePath>index.js</parameter> or <param name="filePath">index.js</param>
 */
function parseXmlParameterTags(rawStr) {
  if (!rawStr || typeof rawStr !== 'string') return null;
  const params = {};
  let matched = false;

  const parseParamValue = (valStr) => {
    const cleaned = valStr.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
    const trimmed = cleaned.trim();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed === 'null') return null;
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return parseRelaxedJson(trimmed);
      } catch {}
    }
    return cleaned;
  };

  // Style 1: <parameter=name>value</parameter>
  const eqParamRegex = /<parameter=([a-zA-Z0-9_.-]+)\s*>([\s\S]*?)<\/parameter>/gi;
  let m;
  while ((m = eqParamRegex.exec(rawStr)) !== null) {
    matched = true;
    params[m[1].trim()] = parseParamValue(m[2]);
  }

  // Style 2: <param name="key">value</param> or <parameter name="key">value</parameter>
  const attrParamRegex = /<param(?:eter)?\s+name=["']?([^"'>\s]+)["']?\s*>([\s\S]*?)<\/param(?:eter)?>/gi;
  while ((m = attrParamRegex.exec(rawStr)) !== null) {
    matched = true;
    params[m[1].trim()] = parseParamValue(m[2]);
  }

  return matched ? params : null;
}

/**
 * Normalizes a parsed JSON tool call object (or array / OpenAI tool_calls wrapper)
 * into an array of { name, args } entries. Preserves flat top-level arguments when
 * arguments/args/parameters wrapper keys are omitted.
 */
function normalizeParsedToolCallObject(parsed) {
  if (!parsed || typeof parsed !== 'object') return [];
  if (Array.isArray(parsed)) {
    return parsed.flatMap(item => normalizeParsedToolCallObject(item));
  }
  if (Array.isArray(parsed.tool_calls)) {
    return parsed.tool_calls.flatMap(item => normalizeParsedToolCallObject(item));
  }

  let target = parsed;
  if (target.function && typeof target.function === 'object' && (target.function.name || target.function.tool)) {
    target = target.function;
  }

  const toolName = target.name || target.tool || target.function_name || (typeof target.function === 'string' ? target.function : null);
  if (!toolName || typeof toolName !== 'string') return [];

  let rawArgs = target.arguments !== undefined
    ? target.arguments
    : (target.args !== undefined
        ? target.args
        : (target.parameters !== undefined
            ? target.parameters
            : (target.params !== undefined ? target.params : target.input)));

  if (typeof rawArgs === 'string') {
    try {
      rawArgs = parseRelaxedJson(rawArgs);
    } catch {
      rawArgs = {};
    }
  }

  let args = {};
  if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
    args = rawArgs;
  } else if (rawArgs === undefined) {
    // Support flat tool call objects where parameters are top-level keys alongside "name"/"tool"
    const metaKeys = new Set(['name', 'tool', 'function_name', 'function', 'type', 'id', 'tool_call_id', 'index']);
    for (const [k, v] of Object.entries(target)) {
      if (!metaKeys.has(k) && v !== undefined) {
        args[k] = v;
      }
    }
  }

  return [{ name: toolName.trim(), args }];
}

// Text-based fallback tool calls detector and parser
export function detectAndParseTextToolCalls(text, contents = null, thoughtText = null, isSubCall = false) {
  const foundCalls = [];
  if (!text && !thoughtText) return { text: text || '', calls: foundCalls };

  let tempText = text || '';
  const sourceText = tempText;

  // 1. Match <tool_call name="tool_name">arguments</tool_call>
  const toolCallTagRegex = /<tool_call\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/tool_call>/gi;
  let match;
  while ((match = toolCallTagRegex.exec(sourceText)) !== null) {
    const name = match[1].trim();
    const rawArgs = match[2].trim();
    let args = {};
    try {
      const xmlArgs = parseXmlParameterTags(rawArgs);
      if (xmlArgs) {
        args = xmlArgs;
      } else {
        args = parseRelaxedJson(rawArgs);
        if (args && typeof args === 'object') {
          if (args.arguments && typeof args.arguments === 'object') {
            args = args.arguments;
          } else if (args.args && typeof args.args === 'object') {
            args = args.args;
          } else if (args.parameters && typeof args.parameters === 'object') {
            args = args.parameters;
          }
        }
      }
    } catch (e) {
      // Ignore invalid JSON parsing in tag content
    }
    foundCalls.push({ name, args, rawMatch: match[0] });
  }

  // 1.2 Match Qwen/Gemma JSON-style <tool_call>{"name": "tool_name", "arguments": ...}</tool_call> or <|tool_call>{...}<tool_call|>
  const qwenToolCallRegex = /<\|?tool_call\|?\s*>(\s*\{[\s\S]*?\}\s*)(?:<\/tool_call>|<\|?tool_call\|?>)(?:\s*<\|?tool_response\|?>)*/gi;
  while ((match = qwenToolCallRegex.exec(sourceText)) !== null) {
    const rawContent = match[1].trim();
    try {
      const parsed = parseRelaxedJson(rawContent);
      const normalized = normalizeParsedToolCallObject(parsed);
      for (const call of normalized) {
        foundCalls.push({ name: call.name, args: call.args, rawMatch: match[0] });
      }
    } catch (e) {
      // Ignore invalid JSON parsing in Qwen tag content
    }
  }

  // 2. Match <call_tool_name>arguments</call_tool_name>
  const callTagRegex = /<call_([a-zA-Z0-9_-]+)>([\s\S]*?)<\/call_\1>/gi;
  while ((match = callTagRegex.exec(sourceText)) !== null) {
    const name = match[1].trim();
    const rawArgs = match[2].trim();
    let args = {};
    try {
      const xmlArgs = parseXmlParameterTags(rawArgs);
      if (xmlArgs) {
        args = xmlArgs;
      } else {
        args = parseRelaxedJson(rawArgs);
        if (args && typeof args === 'object') {
          if (args.arguments && typeof args.arguments === 'object') {
            args = args.arguments;
          } else if (args.args && typeof args.args === 'object') {
            args = args.args;
          } else if (args.parameters && typeof args.parameters === 'object') {
            args = args.parameters;
          }
        }
      }
    } catch (e) {}
    foundCalls.push({ name, args, rawMatch: match[0] });
  }

  // 2.6 Match Gemma 4 / LMStudio style <|tool_call>call:tool_name{arguments}<tool_call|><|tool_response>
  const lmStudioRegex = /(?:<\|?tool_call\|?\s*>\s*)?call:([a-zA-Z0-9_-]+)\s*(\{[\s\S]*?\})\s*(?:<tool_call\|>|<\|tool_call\|>|<\/tool_call>|<\|?tool_response\|?>)(?:\s*<\|?tool_response\|?>)*/gi;
  while ((match = lmStudioRegex.exec(sourceText)) !== null) {
    const name = match[1].trim();
    const rawArgs = match[2].trim();
    let args = {};
    try {
      args = parseRelaxedJson(rawArgs);
    } catch (e) {
      // Ignore invalid parsing
    }
    foundCalls.push({ name, args, rawMatch: match[0] });
  }

  // 2.6b Fallback for unclosed <|tool_call>call:tool_name{arguments} at end of output
  if (foundCalls.length === 0) {
    const unclosedGemmaCallRegex = /<\|?tool_call\|?\s*>\s*call:([a-zA-Z0-9_-]+)\s*(\{[\s\S]*\})\s*$/gi;
    while ((match = unclosedGemmaCallRegex.exec(sourceText)) !== null) {
      const name = match[1].trim();
      const rawArgs = match[2].trim();
      let args = {};
      try {
        args = parseRelaxedJson(rawArgs);
      } catch (e) {}
      foundCalls.push({ name, args, rawMatch: match[0] });
    }
  }

  // 2.5 Match <function=tool_name>arguments</tool_call> or <function=tool_name>arguments</function> (optionally wrapped in <tool_call>...</tool_call>)
  const functionTagRegex = /(?:<\|?tool_call\|?\s*>\s*)?<function=["']?([a-zA-Z0-9_-]+)["']?\s*>([\s\S]*?)(?:<\/function>\s*(?:<\/tool_call>|<\|?tool_call\|?>)?|<\/tool_call>)/gi;
  while ((match = functionTagRegex.exec(sourceText)) !== null) {
    const name = match[1].trim();
    const rawArgs = match[2].trim();
    let args = {};
    try {
      if (rawArgs && rawArgs.trim()) {
        const xmlArgs = parseXmlParameterTags(rawArgs);
        if (xmlArgs) {
          args = xmlArgs;
        } else {
          args = parseRelaxedJson(rawArgs);
          if (args && typeof args === 'object') {
            if (args.arguments && typeof args.arguments === 'object') {
              args = args.arguments;
            } else if (args.args && typeof args.args === 'object') {
              args = args.args;
            } else if (args.parameters && typeof args.parameters === 'object') {
              args = args.parameters;
            }
          }
        }
      }
    } catch (e) {
      // Ignore invalid JSON parsing in tag content
    }
    foundCalls.push({ name, args, rawMatch: match[0] });
  }

  // 2.7 Match tool call tag style [Agent Tool Call: "tool_name" with args: {arguments}] (Ignore "Executed" which indicates past logs)
  const agentToolCallRegex = /\[Agent Tool Call:\s*(?!Executed\b)["']?([a-zA-Z0-9_-]+)["']?\s*(?:with\s+args:|args:)?\s*(\{[\s\S]*?\})\]/gi;
  while ((match = agentToolCallRegex.exec(sourceText)) !== null) {
    const name = match[1].trim();
    const rawArgs = match[2].trim();
    let args = {};
    try {
      args = parseRelaxedJson(rawArgs);
    } catch (e) {
      // Ignore invalid parsing
    }
    foundCalls.push({ name, args, rawMatch: match[0] });
  }

  // 3. Match markdown JSON/raw code blocks
  const markdownRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  while ((match = markdownRegex.exec(sourceText)) !== null) {
    const blockContent = match[1].trim();
    try {
      const parsed = parseRelaxedJson(blockContent);
      const normalized = normalizeParsedToolCallObject(parsed);
      const validCalls = normalized.filter(c => c.name && tools[c.name]);
      if (validCalls.length > 0) {
        for (const call of validCalls) {
          foundCalls.push({ ...call, rawMatch: match[0] });
        }
      }
    } catch (e) {
      // not a valid JSON tool block
    }
  }

  // 4. Try parsing the entire text if it's a raw JSON object
  if (foundCalls.length === 0) {
    const trimmed = sourceText.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = parseRelaxedJson(trimmed);
        const normalized = normalizeParsedToolCallObject(parsed);
        const validCalls = normalized.filter(c => c.name && tools[c.name]);
        if (validCalls.length > 0) {
          for (const call of validCalls) {
            foundCalls.push({ ...call, rawMatch: trimmed });
          }
        }
      } catch (e) {}
    }
  }

  // 5. Intelligent recovery: If model outputs a canned refusal claiming it cannot run background processes or execute commands on the machine,
  // but provided or was previously given the commands and directories, intercept and execute them!
  if (foundCalls.length === 0 && !isSubCall && sourceText) {
    const recoveredCalls = extractRefusedBackgroundCommands(sourceText, contents);
    if (recoveredCalls.length > 0) {
      foundCalls.push(...recoveredCalls);
      tempText = '';
    }
  }

  // 6. Execute Thinking Process: If executeThinking is enabled in settings (or if the model hallucinated execution),
  // extract intended tool calls or commands from the thinking process!
  if (foundCalls.length === 0 && !isSubCall && thoughtText) {
    const isExecutionHallucination = /(?:i have executed|i've executed|status:\s*the process.*is running|started the (?:server|backend|frontend)|has been (?:started|executed) in the background)/i.test(sourceText);
    if (isExecuteThinkingEnabled() || isExecutionHallucination) {
      const thinkingCalls = extractThinkingProcessToolCalls(thoughtText, sourceText, contents);
      if (thinkingCalls.length > 0) {
        foundCalls.push(...thinkingCalls);
        tempText = '';
      }
    }
  }

  // 7. Intelligent recovery: If model claims it cannot inspect/modify files outside specific files
  // or tells user to manually review/check/fix a file (e.g. app.module.ts, package.json),
  // intercept and automatically dispatch findFiles to locate the file in the workspace!
  if (foundCalls.length === 0 && !isSubCall && sourceText) {
    const fileRefusalCalls = extractRefusedFileInvestigations(sourceText);
    if (fileRefusalCalls.length > 0) {
      foundCalls.push(...fileRefusalCalls);
      tempText = '';
    }
  }

  // Strip found calls from text
  for (const call of foundCalls) {
    if (call.rawMatch) {
      tempText = tempText.replace(call.rawMatch, '');
    }
  }

  // Strip any residual special tool/thought delimiter tokens
  tempText = tempText
    .replace(/<\|?tool_response\|?>/gi, '')
    .replace(/<\|?tool_call\|?>/gi, '')
    .trim();

  return {
    text: tempText,
    calls: foundCalls
  };
}

/**
 * Parses executable terminal/server commands from text formatted as sections, bullet points, or code blocks.
 */
export function parseCommandsFromText(text) {
  if (!text || typeof text !== 'string') return [];
  const foundCommands = [];
  const cmdPrefixPattern = '(?:node|npm|npx|ng|yarn|pnpm|bun|python|python3|pip|pip3|flask|uvicorn|cargo|go|sh|bash|zsh|make|cmake|docker|docker-compose|pytest|jest|vitest|mocha|mvn|gradle|dotnet|ruby|bundle|rails|php|composer|git|curl|wget|\\./[^\\s&;]+)';
  const cmdLineRegex = new RegExp(`^${cmdPrefixPattern}(?:\\s+|$)`, 'i');
  const inlineChainRegex = new RegExp(`^cd\\s+[^\\s&;]+.*&&\\s*${cmdPrefixPattern}(?:\\s+|$)`, 'i');

  // Pattern A: Numbered/bulleted sections like "1. For the Backend... cd ... node ..."
  const sections = text.split(/(?=\d+\.\s*(?:For the|Backend|Frontend|Server|API))/i);
  for (const sec of sections) {
    const lines = sec.split('\n').map(l => l.trim().replace(/^[•\-\*`\s]+/, '').replace(/`+$/, ''));
    const header = (lines[0] || '').toLowerCase();

    let name = 'service';
    if (header.includes('backend') || (/backend/i.test(sec) && !header.includes('frontend'))) {
      name = 'backend';
    }
    if (header.includes('frontend') || (/frontend/i.test(sec) && !header.includes('backend'))) {
      name = 'frontend';
    }

    let cdPath = null;
    let runCmd = null;

    for (const line of lines) {
      if (/^cd\s+[^\s&;]+/i.test(line)) {
        cdPath = line;
      } else if (cmdLineRegex.test(line)) {
        runCmd = line;
      }
    }

    if (cdPath && runCmd) {
      foundCommands.push({
        name: 'executeCommand',
        args: {
          command: `${cdPath} && ${runCmd}`,
          background: true,
          name
        },
        rawMatch: sec
      });
    } else if (runCmd) {
      foundCommands.push({
        name: 'executeCommand',
        args: {
          command: runCmd,
          background: true,
          name
        },
        rawMatch: sec
      });
    }
  }

  // Pattern B: Code blocks
  if (foundCommands.length === 0) {
    const codeBlockRegex = /```(?:bash|sh|zsh)?\s*([\s\S]*?)```/gi;
    let cbMatch;
    while ((cbMatch = codeBlockRegex.exec(text)) !== null) {
      const blockContent = cbMatch[1].trim();
      const lines = blockContent.split('\n').map(l => l.trim()).filter(Boolean);
      let cdPath = null;
      let runCmd = null;
      for (const line of lines) {
        if (/^cd\s+/i.test(line)) {
          cdPath = line;
        } else if (cmdLineRegex.test(line)) {
          runCmd = line;
        }
      }
      if (cdPath && runCmd) {
        foundCommands.push({
          name: 'executeCommand',
          args: {
            command: `${cdPath} && ${runCmd}`,
            background: true,
            name: runCmd.includes('ng') ? 'frontend' : 'backend'
          },
          rawMatch: cbMatch[0]
        });
      } else if (runCmd) {
        foundCommands.push({
          name: 'executeCommand',
          args: {
            command: runCmd,
            background: true,
            name: runCmd.includes('ng') ? 'frontend' : 'service'
          },
          rawMatch: cbMatch[0]
        });
      }
    }
  }

  // Pattern C: Consecutive cd and run command lines or inline chains
  if (foundCommands.length === 0) {
    const lines = text.split('\n').map(l => l.trim().replace(/^[•\-\*`\s]+/, '').replace(/`+$/, ''));
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^cd\s+[^\s&;]+/i.test(line)) {
        const cdPart = line;
        let nextRun = null;
        if (i + 1 < lines.length && cmdLineRegex.test(lines[i + 1])) {
          nextRun = lines[i + 1];
          i++;
        }
        const name = (cdPart.includes('frontend') || (nextRun && nextRun.includes('ng'))) ? 'frontend' : 'backend';
        if (nextRun) {
          foundCommands.push({
            name: 'executeCommand',
            args: {
              command: `${cdPart} && ${nextRun}`,
              background: true,
              name
            },
            rawMatch: `${cdPart}\n${nextRun}`
          });
        }
      } else if (inlineChainRegex.test(line)) {
        const name = (line.includes('frontend') || line.includes('ng')) ? 'frontend' : 'backend';
        foundCommands.push({
          name: 'executeCommand',
          args: {
            command: line,
            background: true,
            name
          },
          rawMatch: line
        });
      }
    }
  }

  return foundCommands;
}

/**
 * Intelligent recovery helper: Detects when a model outputs a canned refusal claiming
 * it cannot run persistent servers in the background or cannot execute commands on the machine,
 * and recovers commands either from the refusal text itself or previous turns in contents.
 */
export function extractRefusedBackgroundCommands(text, contents = null) {
  if (!text || typeof text !== 'string') return [];

  const isExecutionRefusal = /(?:cannot|can't|unable to|do not have(?: the ability)?|no access to).*(?:directly run|run|execute|access|perform).*(?:machine|terminal|local|command|application|server|process|environment|setup)|as a (?:large )?language model.*(?:terminal|machine|local|run|execute|server|process)/is.test(text);
  if (!isExecutionRefusal) return [];

  const fromCurrentText = parseCommandsFromText(text);
  if (fromCurrentText.length > 0) return fromCurrentText;

  // Fallback: If refusal did not include commands, scan previous turn contents for commands
  if (contents && Array.isArray(contents)) {
    for (let i = contents.length - 1; i >= 0; i--) {
      const c = contents[i];
      for (const p of (c.parts || [])) {
        if (p.text && typeof p.text === 'string') {
          const fromHistory = parseCommandsFromText(p.text);
          if (fromHistory.length > 0) {
            return fromHistory;
          }
        }
      }
    }
  }

  return [];
}

/**
 * Intelligent thinking process helper: Extracts tool calls or intended execution commands
 * directly from the model's thinking process (<thinking>...</thinking> or reasoning fields).
 */
export function extractThinkingProcessToolCalls(thoughtText, text = '', contents = null) {
  if (!thoughtText || typeof thoughtText !== 'string') return [];
  const calls = [];

  // 1. Try standard text tool call parsing on thoughtText itself (JSON blocks, <|tool_call> tags, etc.)
  const standardCalls = detectAndParseTextToolCalls(thoughtText, null, null, true);
  if (standardCalls && standardCalls.calls && standardCalls.calls.length > 0) {
    return standardCalls.calls;
  }

  // 1.5. Match inline function-call expressions like toolName({ ... }) inside thoughtText
  const inlineFnRegex = /\b([a-zA-Z0-9_]+)\s*\(\s*(\{[\s\S]*?\})\s*\)/g;
  let fnMatch;
  while ((fnMatch = inlineFnRegex.exec(thoughtText)) !== null) {
    const toolName = fnMatch[1].trim();
    if (tools[toolName]) {
      try {
        const args = parseRelaxedJson(fnMatch[2]);
        calls.push({ name: toolName, args, rawMatch: fnMatch[0] });
      } catch (e) {}
    }
  }
  if (calls.length > 0) {
    return calls;
  }

  // 2. Direct commands from thoughtText
  const directCommands = parseCommandsFromText(thoughtText);
  if (directCommands.length > 0) {
    return directCommands;
  }

  // 3. Mentions of executeCommand, running shell commands, or background setup in thoughtText
  const mentionsExecute = /(?:executeCommand|running shell commands|run(?:ning)? (?:the )?commands?|execute(?: in background)?)/i.test(thoughtText);
  if (mentionsExecute) {
    // Check if full commands are present in conversation history or refusal/setup steps
    if (contents && Array.isArray(contents)) {
      for (let i = contents.length - 1; i >= 0; i--) {
        const c = contents[i];
        for (const p of (c.parts || [])) {
          if (p.text && typeof p.text === 'string') {
            const historyCmds = parseCommandsFromText(p.text);
            if (historyCmds.length > 0) {
              return historyCmds;
            }
          }
        }
      }
    }

    // Check if text (e.g., Next Step: cd ... ng serve ...) contains commands
    if (text) {
      const textCmds = parseCommandsFromText(text);
      if (textCmds.length > 0) {
        return textCmds;
      }
    }

    // Check if thoughtText mentions specific executable commands in backticks
    const backticks = [...thoughtText.matchAll(/`([^`]+)`/g)].map(m => m[1].trim());
    const explicitCmds = backticks.filter(cmd => 
      /^(?:node|npm|npx|yarn|pnpm|bun|python|python3|flask|uvicorn|cargo|go)\s+/i.test(cmd)
    );
    if (explicitCmds.length > 0) {
      for (const cmd of explicitCmds) {
        calls.push({
          name: 'executeCommand',
          args: {
            command: cmd,
            background: /(?:server|background|long-running)/i.test(thoughtText),
            name: /(?:dev|serve|start|frontend|client)/i.test(cmd) ? 'frontend' : 'service'
          },
          rawMatch: cmd
        });
      }
      return calls;
    }
  }

  // 3.5. Mentions of restClient or HTTP requests (GET, POST, PUT, DELETE, PATCH) against a URL in thoughtText
  if (/\brestClient\b|(?:perform|make|send|test|issue)\s+(?:a\s+)?(?:GET|POST|PUT|DELETE|PATCH)\s+request/i.test(thoughtText)) {
    const urlMatch = thoughtText.match(/https?:\/\/[^\s`"')>\]}]+/i);
    if (urlMatch) {
      const url = urlMatch[0].replace(/[.,;]+$/, '');
      const methodMatch = thoughtText.match(/\b(GET|POST|PUT|DELETE|PATCH)\b/i);
      const method = methodMatch ? methodMatch[1].toUpperCase() : 'GET';
      return [{
        name: 'restClient',
        args: { method, url },
        rawMatch: urlMatch[0]
      }];
    }
  }

  // 4. Hallucinated execution recovery (e.g. model claiming it executed commands)
  const isExecutionHallucination = /(?:i have executed|i've executed|status:\s*the process.*is running|started the (?:server|backend|frontend)|has been (?:started|executed) in the background)/i.test(text);
  if (isExecutionHallucination) {
    if (contents && Array.isArray(contents)) {
      for (let i = contents.length - 1; i >= 0; i--) {
        const c = contents[i];
        for (const p of (c.parts || [])) {
          if (p.text && typeof p.text === 'string') {
            const historyCmds = parseCommandsFromText(p.text);
            if (historyCmds.length > 0) {
              return historyCmds;
            }
          }
        }
      }
    }
    if (text) {
      const textCmds = parseCommandsFromText(text);
      if (textCmds.length > 0) {
        return textCmds;
      }
    }
  }

  return calls;
}

/**
 * Detects whether a thinking text contains an actionable plan or intended tool steps
 * that need execution.
 */
export function hasActionableThinkingPlan(thoughtText, text = '') {
  if (!thoughtText || typeof thoughtText !== 'string') return false;
  
  // Explicit mentions of any registered tool name
  const toolNames = Object.keys(tools);
  const hasToolMentions = toolNames.some(name => new RegExp(`\\b${name}\\b`, 'i').test(thoughtText)) ||
    /(?:executeCommand|writeFile|makeDirectory|codeFixer|searchReplace|searchGrep|findFiles|readFile|processManager|portManager|restClient|apiPerformanceTest|fetchWebPage|gitHelper|dbExplorer|codeFormatter|dependencyScanner|regexHelper)/i.test(thoughtText);
  if (hasToolMentions) return true;

  // Mentions of HTTP/API requests or endpoint testing
  if (/(?:(?:GET|POST|PUT|DELETE|PATCH)\s+request|https?:\/\/localhost[:/]|test\s+the\s+(?:proxy|api|endpoint|server))/i.test(thoughtText)) {
    return true;
  }

  // Mentions of shell commands, background setup, servers, or dependencies
  const hasCommandIntent = /(?:(?:run|execute|launch|start|install|build|serve)\s+(?:the\s+)?(?:command|service|server|process|backend|frontend|client|script|dependencies|packages)|(?:npm|yarn|pnpm|bun|node|npx|python|python3|cargo|go)\s+[a-z0-9_\-\.\/]+|`[^`]*(?:npm|node|npx|python|cargo|go|cd|install|run|start|serve)[^`]*`)/i.test(thoughtText);
  if (hasCommandIntent) return true;

  // Multi-step numbered or bulleted plan
  const hasNumberedPlan = /(?:(?:plan\s+involved|steps?(?:\s+to\s+execute)?|\b(?:step\s+)?\d+\.)\s*[`a-z0-9_\-\.\/]+)/i.test(thoughtText);
  if (hasNumberedPlan && /(?:backend|frontend|server|file|dir|create|build|run|execute|setup|install)/i.test(thoughtText)) return true;

  return false;
}

/**
 * Intelligent file investigation helper: Detects when a model hallucinates that it cannot
 * inspect or modify files outside of a specific scope, claims it is in a sandboxed environment,
 * or tells the user to manually open/edit/review a configuration or source file.
 * Automatically extracts the file name and dispatches readFile or findFiles/listFiles to locate it in the workspace.
 */
export function extractRefusedFileInvestigations(text) {
  if (!text || typeof text !== 'string') return [];
  const calls = [];

  const isFileOrDirectoryRefusal = /(?:sandboxed environment|cannot.*(?:directly )?(?:open|edit|read|modify|change|write|access|inspect).*files?|do not have the (?:ability|capability|permission) to.*(?:open|edit|read|modify|change|write|access|inspect).*files?|unable to.*(?:open|edit|read|modify|change|write).*files?|cannot.*(?:read|list|view|access|open).*(?:directories|folders|directory|folder)|do not have the (?:ability|capability|permission) to.*(?:read|list|view|access|open).*(?:directories|folders|directory|folder)|cannot modify.*outside of these specific files|without knowing your\s+[`"']?[a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+|manually review your\s+[`"']?[a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+|you must manually (?:perform|review|check|edit|update|inspect|modify|fix|open|add|change)|manually perform these steps|assume you will fix the (?:module|config|configuration|setup|build))/i.test(text);

  if (!isFileOrDirectoryRefusal) return [];

  // Check if it's explicitly a directory reading refusal
  const isDirRefusal = /(?:cannot.*(?:read|list|view|access|open).*(?:directories|folders|directory|folder)|do not have the (?:ability|capability|permission) to.*(?:read|list|view|access|open).*(?:directories|folders|directory|folder))/i.test(text);

  const fileRegexes = [
    /(?:(?:Navigate|go)\s+to|(?:Open|edit|review|check|inspect)\s+(?:the\s+)?file:?|file:?)\s*(?:Navigate\s+to\s+)?([`"']?)([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)\1/i,
    /(?:module|configuration|config in|file named|manifest in)\s*\(\s*[`"']?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)[`"']?\s*\)/i,
    /(?:without knowing your|manually review your|manually check your|manually inspect your|review your|check your|open your)\s+[`"']?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)[`"']?/i,
    /(?:cannot modify.*outside of these specific files.*[`"']?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)[`"']?)/i,
    /(?:you must manually (?:perform|review|check|edit|update|inspect|modify|fix|open|add|change).*?)\s+[`"']?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)[`"']?/i,
    /([a-zA-Z0-9_\-./]+\.(?:json|js|mjs|cjs|ts|tsx|jsx|html|css|py|md|yml|yaml|go|rs|java|c|cpp|h|php|rb|sh)\b)/i
  ];

  let matchedFile = null;
  for (const regex of fileRegexes) {
    const m = text.match(regex);
    if (m && m[1]) {
      let candidate = m[1].replace(/[\r\n\t]+/g, '').trim();
      candidate = candidate.replace(/[.,:;)\s]+$/, '').trim();
      if (candidate.startsWith('/') || candidate.includes('/')) {
        candidate = candidate.replace(/\s+/g, '');
      }
      if (/\.[a-zA-Z0-9]+$/.test(candidate)) {
        matchedFile = candidate;
        break;
      }
    }
  }

  if (matchedFile) {
    const cwd = process.cwd();
    const resolvedPath = path.resolve(cwd, matchedFile);
    const cwdWithSep = cwd.endsWith(path.sep) ? cwd : cwd + path.sep;
    const isWithinCwd = resolvedPath === cwd || resolvedPath.startsWith(cwdWithSep);

    // If the matched file exists directly on disk within cwd, read it directly!
    if (isWithinCwd && fs.existsSync(resolvedPath)) {
      calls.push({
        name: 'readFile',
        args: { filePath: path.relative(cwd, resolvedPath) || resolvedPath }
      });
      return calls;
    }

    const baseName = path.basename(matchedFile);
    const parentDir = path.dirname(matchedFile);
    const resolvedParent = path.resolve(cwd, parentDir);
    const isParentWithinCwd = resolvedParent === cwd || resolvedParent.startsWith(cwdWithSep);

    // If parent directory exists on disk within cwd, list files in that directory
    if (isParentWithinCwd && parentDir && parentDir !== '.' && fs.existsSync(resolvedParent)) {
      calls.push({
        name: 'listFiles',
        args: { directory: path.relative(cwd, resolvedParent) || '.' }
      });
      return calls;
    }

    // Otherwise, search for matching files by wildcard
    calls.push({
      name: 'findFiles',
      args: { pattern: `*${baseName}` }
    });
  } else if (isDirRefusal) {
    calls.push({
      name: 'listFiles',
      args: { directory: '.' }
    });
  } else if (/outside of these specific files|cannot modify.*application structure/i.test(text)) {
    calls.push({
      name: 'listFiles',
      args: { directory: '.' }
    });
  }

  return calls;
}

export function isValidImageBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 2 && (
    (buffer[0] === 0xff && buffer[1] === 0xd8) || // JPEG
    (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) || // PNG
    (buffer.length >= 4 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) || // GIF
    (buffer[0] === 0x42 && buffer[1] === 0x4d) // BMP
  );
}

export function getImageMimeType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 2) {
    return 'image/png';
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return 'image/jpeg';
  }
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }
  if (buffer.length >= 4 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return 'image/gif';
  }
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return 'image/bmp';
  }
  return 'image/png';
}

export function startSpinner(message) {
  if (!process.stdout.isTTY || process.env.PLUMAR_QUIET === 'true') {
    return { stop: () => {} };
  }

  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  let i = 0;
  const timer = setInterval(() => {
    process.stdout.write(`\r\x1b[K\x1b[2m${message}\x1b[0m \x1b[33m${frames[i]}\x1b[0m`);
    i = (i + 1) % frames.length;
  }, 80);

  // Initial draw
  process.stdout.write(`\r\x1b[K\x1b[2m${message}\x1b[0m \x1b[33m${frames[0]}\x1b[0m`);

  return {
    stop: () => {
      clearInterval(timer);
      process.stdout.write('\r\x1b[K');
    }
  };
}

/**
 * Strips the redundant markdown "### Available Tools & Parameter Schemas" block
 * from the system prompt when native tool schemas are already passed via `requestPayload.tools`.
 */
export function stripRedundantToolSchemasFromPrompt(prompt) {
  if (!prompt || typeof prompt !== 'string') return prompt;
  return prompt.replace(/\n*### Available Tools & Parameter Schemas\b[\s\S]*?(?=\n#{2,3}\s|$)/, '').trim();
}

/**
 * Reads an NDJSON (Ollama) or SSE (LM Studio / OpenAI) ReadableStream response
 * and aggregates tokens, thinking/reasoning, tool_calls, and token usage metrics.
 */
export async function readStreamingResponse(bodyStream, provider = 'ollama', onToken = null) {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let content = '';
  let thinking = '';
  const toolCalls = [];
  const images = [];
  let promptEvalCount;
  let evalCount;
  let usage;
  let error = null;

  const processLine = (rawLine) => {
    let line = rawLine.trim();
    if (!line) return;
    if (line.startsWith('data:')) {
      line = line.slice(5).trim();
      if (line === '[DONE]') return;
    }
    let chunk;
    try {
      chunk = JSON.parse(line);
    } catch {
      return;
    }
    if (chunk.error) {
      error = chunk.error;
      return;
    }

    // Ollama NDJSON format
    if (chunk.message) {
      const msg = chunk.message;
      const deltaContent = msg.content || '';
      const deltaThinking = msg.thinking || msg.reasoning || msg.reasoning_content || '';
      if (deltaContent) content += deltaContent;
      if (deltaThinking) thinking += deltaThinking;
      if (onToken && (deltaContent || deltaThinking)) {
        onToken(deltaContent, deltaThinking);
      }
      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          toolCalls.push(tc);
        }
      }
      if (Array.isArray(msg.images)) {
        images.push(...msg.images);
      }
    }

    // OpenAI / LM Studio SSE format
    if (Array.isArray(chunk.choices) && chunk.choices.length > 0) {
      const choice = chunk.choices[0];
      const delta = choice.delta || choice.message || {};
      const deltaContent = delta.content || '';
      const deltaThinking = delta.reasoning || delta.reasoning_content || delta.thinking || '';
      if (deltaContent) content += deltaContent;
      if (deltaThinking) thinking += deltaThinking;
      if (onToken && (deltaContent || deltaThinking)) {
        onToken(deltaContent, deltaThinking);
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = typeof tc.index === 'number' ? tc.index : toolCalls.length;
          if (!toolCalls[idx]) {
            toolCalls[idx] = {
              id: tc.id || `call_${idx}`,
              type: 'function',
              function: {
                name: tc.function?.name || '',
                arguments: tc.function?.arguments || ''
              }
            };
          } else {
            if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
            if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
          }
        }
      }
    }

    if (typeof chunk.prompt_eval_count === 'number') promptEvalCount = chunk.prompt_eval_count;
    if (typeof chunk.eval_count === 'number') evalCount = chunk.eval_count;
    if (chunk.done_reason) doneReason = chunk.done_reason;
    if (chunk.usage) usage = chunk.usage;
  };

  let doneReason;

  if (bodyStream && typeof bodyStream.getReader === 'function') {
    const reader = bodyStream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += typeof value === 'string' ? value : decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const l of lines) {
          processLine(l);
        }
      }
      if (buffer.trim()) {
        processLine(buffer);
      }
    } finally {
      reader.releaseLock?.();
    }
  } else if (bodyStream && Symbol.asyncIterator in bodyStream) {
    for await (const chunk of bodyStream) {
      buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const l of lines) {
        processLine(l);
      }
    }
    if (buffer.trim()) {
      processLine(buffer);
    }
  }

  if (error) {
    return { error };
  }

  const assembledMessage = {
    role: 'assistant',
    content,
    ...(thinking ? { thinking } : {}),
    ...(toolCalls.filter(Boolean).length > 0 ? { tool_calls: toolCalls.filter(Boolean) } : {}),
    ...(images.length > 0 ? { images } : {})
  };

  if (provider === 'lmstudio') {
    return {
      choices: [{ message: assembledMessage, ...(doneReason ? { finish_reason: doneReason } : {}) }],
      ...(doneReason ? { done_reason: doneReason } : {}),
      usage
    };
  }

  return {
    message: assembledMessage,
    prompt_eval_count: promptEvalCount,
    eval_count: evalCount,
    ...(doneReason ? { done_reason: doneReason } : {}),
    usage
  };
}

async function parseResponseOrStream(response, provider, onToken = null) {
  const contentType = response?.headers?.get?.('content-type') || '';
  const isStreamHeader = contentType.includes('application/x-ndjson') || contentType.includes('text/event-stream');
  if ((isStreamHeader || typeof response.json !== 'function') && response?.body) {
    return await readStreamingResponse(response.body, provider, onToken);
  }
  return await response.json();
}

const sessionContextTokensMap = new Map();

/**
 * Compacts older tool outputs, large historical file-write tool_calls arguments,
 * and older intermediate steps when total prompt tokens approach `numCtx`, ensuring
 * at least `minOutputHeadroom` tokens remain available in Ollama's KV cache so
 * responses are never truncated mid-sentence (`done_reason: "length"`).
 */
export function compactMessagesForContextHeadroom(messages, numCtx = 16384, toolsList = null, lastKnownTokens = 0, forceCompact = false) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  const effectiveCtx = typeof numCtx === 'number' && numCtx > 0 ? numCtx : 16384;
  const minOutputHeadroom = forceCompact
    ? Math.min(8192, Math.max(3072, Math.floor(effectiveCtx * 0.3)))
    : Math.min(6144, Math.max(2048, Math.floor(effectiveCtx * 0.2)));
  const maxPromptTokens = Math.max(4096, effectiveCtx - minOutputHeadroom);

  const toolsChars = toolsList ? JSON.stringify(toolsList).length : 0;
  const initialMessagesChars = JSON.stringify(messages).length;
  // Code + JSON tokenizes at roughly ~2.6 chars per token in Gemma/Llama tokenizers
  const CHARS_PER_TOKEN = 2.6;
  const estimatedTokens = Math.ceil((initialMessagesChars + toolsChars) / CHARS_PER_TOKEN);
  const effectiveTokens = Math.max(estimatedTokens, lastKnownTokens || 0);

  if (!forceCompact && effectiveTokens <= maxPromptTokens) {
    return messages;
  }

  const cloned = messages.map(m => ({
    ...m,
    ...(Array.isArray(m.tool_calls)
      ? {
          tool_calls: m.tool_calls.map(tc => ({
            ...tc,
            ...(tc.function ? { function: { ...tc.function } } : {})
          }))
        }
      : {})
  }));

  const firstUserIdx = cloned.findIndex(m => m.role === 'user');
  const recentProtected = forceCompact ? 4 : 6;
  const compactEndIdx = Math.max(firstUserIdx + 1, cloned.length - recentProtected);

  const compactToolArgsObject = (argsObj) => {
    if (!argsObj || typeof argsObj !== 'object') return argsObj;
    const copy = Array.isArray(argsObj) ? [...argsObj] : { ...argsObj };
    for (const k of Object.keys(copy)) {
      if (typeof copy[k] === 'string' && copy[k].length > 350) {
        copy[k] = `${copy[k].slice(0, 150)}... [compacted ${copy[k].length} chars in history]`;
      } else if (copy[k] && typeof copy[k] === 'object') {
        copy[k] = compactToolArgsObject(copy[k]);
      }
    }
    return copy;
  };

  // Stage 1 & 2: Condense older thinking blocks, large tool_calls arguments, and older tool outputs
  for (let i = Math.max(0, firstUserIdx + 1); i < compactEndIdx; i++) {
    const msg = cloned[i];
    if (!msg) continue;

    if (msg.role === 'assistant') {
      if (typeof msg.content === 'string' && msg.content.length > 0) {
        let c = msg.content.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
        if (c.length > 500) {
          c = c.slice(0, 350) + '\n... [prior assistant step condensed] ...';
        }
        msg.content = c;
      }
      if (Array.isArray(msg.tool_calls)) {
        msg.tool_calls = msg.tool_calls.map(tc => {
          if (!tc?.function?.arguments) return tc;
          const rawArgs = tc.function.arguments;
          if (typeof rawArgs === 'string') {
            if (rawArgs.length > 400) {
              try {
                const parsed = JSON.parse(rawArgs);
                tc.function.arguments = JSON.stringify(compactToolArgsObject(parsed));
              } catch {
                tc.function.arguments = rawArgs.slice(0, 200) + '..." [compacted]}';
              }
            }
          } else if (typeof rawArgs === 'object') {
            tc.function.arguments = compactToolArgsObject(rawArgs);
          }
          return tc;
        });
      }
    } else if (msg.role === 'tool') {
      if (typeof msg.content === 'string' && msg.content.length > 500) {
        msg.content = msg.content.slice(0, 250) + ' ... [prior tool output condensed] ... ' + msg.content.slice(-150);
      }
    }
  }

  // Stage 3: If still above budget (or if forceCompact / lastKnownTokens requires deeper reduction),
  // drop oldest intermediate assistant+tool exchange messages between firstUserIdx and recentProtected
  const maxMessagesChars = Math.max(
    10000,
    Math.floor(maxPromptTokens * CHARS_PER_TOKEN) - toolsChars
  );
  // If compaction was triggered by Ollama's actual token counter (lastKnownTokens > maxPromptTokens) or forceCompact,
  // also ensure we reduce message characters by at least 25% so actual KV-cache tokens drop significantly.
  const targetChars = (forceCompact || lastKnownTokens > maxPromptTokens)
    ? Math.min(maxMessagesChars, Math.floor(initialMessagesChars * 0.72))
    : maxMessagesChars;

  const removeStartIdx = firstUserIdx >= 0 ? firstUserIdx + 1 : (cloned[0]?.role === 'system' ? 1 : 0);
  while (
    JSON.stringify(cloned).length > targetChars &&
    cloned.length - recentProtected > removeStartIdx
  ) {
    cloned.splice(removeStartIdx, 1);
    // If we removed an assistant message with tool_calls, also remove its immediate orphaned tool responses
    while (
      cloned.length - recentProtected > removeStartIdx &&
      cloned[removeStartIdx]?.role === 'tool'
    ) {
      cloned.splice(removeStartIdx, 1);
    }
  }

  return cloned;
}

// Custom BaseLlm implementation for local/remote Ollama instance
export class Ollama extends BaseLlm {
  constructor({ model, sessionId, options }) {
    super({ model });
    this[Symbol.for('google.adk.baseModel')] = true;
    this.sessionId = sessionId;
    this.options = options || {};
  }

  async *generateContentAsync(llmRequest, stream = false, abortSignal) {
    this.lastError = null;
    const activeSignal = abortSignal || this.abortSignal;
    if (isVerboseJsonEnabled()) {
      console.log('ADK llmRequest:', JSON.stringify(llmRequest, null, 2));
    }
    // Extract system instruction string
    let systemInstruction = '';
    if (llmRequest.config?.systemInstruction) {
      if (typeof llmRequest.config.systemInstruction === 'string') {
        systemInstruction = llmRequest.config.systemInstruction;
      } else if (Array.isArray(llmRequest.config.systemInstruction.parts)) {
        systemInstruction = llmRequest.config.systemInstruction.parts[0]?.text || '';
      }
    }

    const fullSystemInstruction = systemInstruction;
    const ollamaTools = adkToolsToOllamaTools(llmRequest.config?.tools);
    // When native tool schemas are passed in requestPayload.tools, strip the redundant markdown
    // "### Available Tools & Parameter Schemas" block from systemInstruction to save ~4,500 tokens of context.
    const effectiveSystemInstruction = (ollamaTools && ollamaTools.length > 0)
      ? stripRedundantToolSchemasFromPrompt(systemInstruction)
      : systemInstruction;
    const messages = adkContentsToOllamaMessages(llmRequest.contents || [], effectiveSystemInstruction);
    
    // Map OpenAI formatted messages to Ollama native /api/chat formatted messages
    const ollamaMessages = messages.map(msg => {
      const mappedMsg = { ...msg };
      if (mappedMsg.role === 'assistant' && typeof mappedMsg.content === 'string') {
        const thinkMatches = [...mappedMsg.content.matchAll(/<thinking>\s*([\s\S]*?)\s*<\/thinking>/gi)];
        if (thinkMatches.length > 0) {
          const extractedThoughts = thinkMatches.map(m => m[1].trim()).filter(Boolean).join('\n\n');
          if (extractedThoughts) {
            mappedMsg.thinking = mappedMsg.thinking
              ? `${mappedMsg.thinking}\n\n${extractedThoughts}`
              : extractedThoughts;
          }
          mappedMsg.content = mappedMsg.content.replace(/<thinking>[\s\S]*?<\/thinking>\s*/gi, '').trim();
        }
      }
      if (mappedMsg.tool_calls && Array.isArray(mappedMsg.tool_calls)) {
        mappedMsg.tool_calls = mappedMsg.tool_calls.map(tc => {
          const mappedTc = { ...tc };
          if (mappedTc.function && typeof mappedTc.function.arguments === 'string') {
            try {
              mappedTc.function.arguments = JSON.parse(mappedTc.function.arguments);
            } catch (e) {
              // ignore
            }
          }
          return mappedTc;
        });
      }
      if (mappedMsg.role === 'tool') {
        mappedMsg.tool_name = mappedMsg.name;
      }
      return mappedMsg;
    });

    const provider = getLlmProvider();
    const providerName = provider === 'lmstudio' ? 'LM Studio' : 'Ollama';

    const baseUrl = getOllamaBaseUrl();
    const specLoader = startSpinner(`Inspecting specs for '${this.model}'...`);

    // Inspect model specifications proactively to check architecture and family
    const modelDetails = await getModelDetails(this.model);
    const modelContextLength = await getModelContextLength(this.model);

    specLoader.stop();

    const hasDraftPredictParam =
      (typeof modelDetails?.parameters === 'string' && modelDetails.parameters.includes('draft_num_predict')) ||
      (typeof modelDetails?.details?.parent_model === 'string' && modelDetails.details.parent_model.includes('draft'));

    const payloadOptions = {
      num_ctx: modelContextLength,
      num_predict: -1,
      ...(hasDraftPredictParam ? { draft_num_predict: 0 } : {}),
      ...this.options
    };

    const lastKnownTokens = this.sessionId ? (sessionContextTokensMap.get(this.sessionId) || 0) : 0;
    const compactedOllamaMessages = compactMessagesForContextHeadroom(
      ollamaMessages,
      payloadOptions.num_ctx,
      ollamaTools,
      lastKnownTokens
    );
    const compactedOpenAiMessages = compactMessagesForContextHeadroom(
      messages,
      payloadOptions.num_ctx,
      ollamaTools,
      lastKnownTokens
    );
    if (this.sessionId && compactedOllamaMessages !== ollamaMessages) {
      sessionContextTokensMap.delete(this.sessionId);
    }

    let requestUrl;
    let requestPayload;

    if (provider === 'lmstudio') {
      let url = baseUrl;
      if (!url.endsWith('/v1') && !url.includes('/v1/')) {
        url = url + '/v1';
      }
      requestUrl = `${url}/chat/completions`;
      requestPayload = {
        model: this.model,
        messages: compactedOpenAiMessages, // Standard OpenAI format
        tools: ollamaTools,
        stream: Boolean(stream),
        temperature: payloadOptions.temperature ?? llmRequest.config?.temperature ?? 0.7
      };
    } else {
      requestUrl = `${baseUrl}/api/chat`;
      requestPayload = {
        model: this.model,
        messages: compactedOllamaMessages,
        tools: ollamaTools,
        stream: Boolean(stream),
        temperature: payloadOptions.temperature ?? llmRequest.config?.temperature ?? 0.7,
        options: payloadOptions
      };
    }

    const familySpec = (modelDetails?.details?.family || '').toLowerCase();
    const familiesSpec = (modelDetails?.details?.families || []).map(f => String(f).toLowerCase());
    const architectureSpec = (modelDetails?.model_info?.['general.architecture'] || '').toLowerCase();

    const isGemma2Spec = familySpec === 'gemma2' || familiesSpec.includes('gemma2') || architectureSpec === 'gemma2';

    if (isGemma2Spec && requestPayload.tools) {
      if (isVerboseJsonEnabled()) {
        console.log(`[${providerName} ADK] Proactively stripping tools from '${this.model}' based on model specs (family/architecture: gemma2) to prevent freeze/hang.`);
      }
      delete requestPayload.tools;
      const sysMsg = requestPayload.messages?.find(m => m.role === 'system');
      if (sysMsg && fullSystemInstruction) {
        sysMsg.content = fullSystemInstruction;
      }
    }

    if (isVerboseJsonEnabled()) {
      console.log(`${providerName} Request Payload:`, JSON.stringify(requestPayload, null, 2));
    }

    let response;
    let data;
    let fallbackTextMode = false;

    const chatLoader = startSpinner(`Awaiting ${providerName} response ('${this.model}')...`);

    try {
      try {
        response = await fetch(requestUrl, {
          method: 'POST',
          headers: getOllamaHeaders(),
          body: JSON.stringify(requestPayload),
          signal: activeSignal
        });
      } finally {
        chatLoader.stop();
      }
      
      if (!response.ok) {
        let errText = await response.text();
        const errTextLower = errText.toLowerCase();

        // Auto-recover if Ollama fails context initialization due to draft_num_predict / ctx_other or oversized num_ctx
        const isContextInitErr =
          errTextLower.includes('llama_init_from_model') ||
          errTextLower.includes('ctx_other') ||
          errTextLower.includes('failed to initialize the context') ||
          errTextLower.includes('out of memory');

        if (isContextInitErr && provider === 'ollama') {
          requestPayload.options = {
            ...(requestPayload.options || {}),
            draft_num_predict: 0,
            num_ctx: Math.min(requestPayload.options?.num_ctx || 16384, 16384)
          };
          const ctxRetryLoader = startSpinner(`Retrying '${this.model}' with safe context parameters...`);
          try {
            response = await fetch(requestUrl, {
              method: 'POST',
              headers: getOllamaHeaders(),
              body: JSON.stringify(requestPayload),
              signal: activeSignal
            });
          } finally {
            ctxRetryLoader.stop();
          }
          if (!response.ok) {
            errText = await response.text();
          }
        }

        if (!response.ok) {
          const retryErrLower = errText.toLowerCase();
          const hasToolKeyword = retryErrLower.includes('tool') || retryErrLower.includes('tools') || retryErrLower.includes('tool_calls') || retryErrLower.includes('messages') || retryErrLower.includes('payload') || retryErrLower.includes('structure') || retryErrLower.includes('role');
          const hasUnsupportedKeyword = retryErrLower.includes('unsupported') || retryErrLower.includes('not support') || retryErrLower.includes('unknown') || retryErrLower.includes('invalid') || retryErrLower.includes('disabled') || retryErrLower.includes('bad request') || retryErrLower.includes('parameter') || retryErrLower.includes('structure') || retryErrLower.includes('payload');
          const isToolErr = hasToolKeyword && hasUnsupportedKeyword;
          if (isToolErr) {
            fallbackTextMode = true;
          } else {
            if (errText.includes('mllama') || errText.includes('unknown model architecture')) {
              throw new Error(`${providerName} API error: ${response.status} ${response.statusText} - ${errText}\n\nThis error occurs because your local ${providerName} server is outdated and does not support the 'mllama' vision architecture required by '${this.model}'. Please update to the latest version, or switch to a supported text model using the '/model' command (e.g. '/model qwen2.5:latest' or '/model llama3:latest').`);
            }
            throw new Error(`${providerName} API error: ${response.status} ${response.statusText} - ${errText}`);
          }
        } else {
          data = await parseResponseOrStream(response, provider, this.options?.onToken);
        }
      } else {
        data = await parseResponseOrStream(response, provider, this.options?.onToken);
        if (data && data.error) {
          const errStr = typeof data.error === 'string' ? data.error.toLowerCase() : '';
          const hasToolKeyword = errStr.includes('tool') || errStr.includes('tools') || errStr.includes('tool_calls') || errStr.includes('messages') || errStr.includes('payload') || errStr.includes('structure') || errStr.includes('role');
          const hasUnsupportedKeyword = errStr.includes('unsupported') || errStr.includes('not support') || errStr.includes('unknown') || errStr.includes('invalid') || errStr.includes('disabled') || errStr.includes('parameter') || errStr.includes('structure') || errStr.includes('payload');
          const isToolErr = errStr && hasToolKeyword && hasUnsupportedKeyword;
          if (isToolErr) {
            fallbackTextMode = true;
          } else {
            const errStr = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
            if (errStr.includes('mllama') || errStr.includes('unknown model architecture')) {
              throw new Error(`${providerName} error: ${errStr}\n\nThis error occurs because your local ${providerName} server is outdated and does not support the 'mllama' vision architecture required by '${this.model}'. Please update to the latest version, or switch to a supported text model using the '/model' command (e.g. '/model qwen2.5:latest' or '/model llama3:latest').`);
            }
            throw new Error(`${providerName} error: ${data.error}`);
          }
        } else if (provider === 'lmstudio' && requestPayload.tools) {
          // Detect LM Studio silent-failure where passing the tools parameter returns a successful 200 OK response
          // but with a completely empty assistant message and no native tool calls.
          const msg = data.choices?.[0]?.message;
          const content = msg?.content || '';
          const toolCalls = msg?.tool_calls;
          if (!content.trim() && (!toolCalls || toolCalls.length === 0)) {
            fallbackTextMode = true;
          }
        }
      }
    } catch (err) {
      const errMsg = err.message ? err.message.toLowerCase() : '';
      const hasToolKeyword = errMsg.includes('tool') || errMsg.includes('tools') || errMsg.includes('tool_calls') || errMsg.includes('messages') || errMsg.includes('payload') || errMsg.includes('structure') || errMsg.includes('role');
      const hasUnsupportedKeyword = errMsg.includes('unsupported') || errMsg.includes('not support') || errMsg.includes('unknown') || errMsg.includes('invalid') || errMsg.includes('disabled') || errMsg.includes('parameter') || errMsg.includes('structure') || errMsg.includes('payload');
      const isToolErr = errMsg && hasToolKeyword && hasUnsupportedKeyword;
      if (isToolErr) {
        fallbackTextMode = true;
      } else {
        this.lastError = err;
        throw err;
      }
    }

    if (fallbackTextMode) {
      console.log(`\n\x1b[2m[${providerName} ADK] Model '${this.model}' retrying in text-only mode...\x1b[0m`);
      
      // Strip tools from payload
      delete requestPayload.tools;

      // Clean up and normalize history messages for text-only mode to prevent schema errors or silent failures in LM Studio
      if (requestPayload.messages && Array.isArray(requestPayload.messages)) {
        const cleanedMessages = [];
        
        for (const msg of requestPayload.messages) {
          const role = msg.role;
          
          if (role === 'assistant') {
            const hasToolCalls = msg.tool_calls && msg.tool_calls.length > 0;
            let content = msg.content || '';
            
            if (hasToolCalls) {
              const callsDesc = msg.tool_calls.map(tc => {
                const name = tc.function?.name || '';
                let args = tc.function?.arguments || '{}';
                if (typeof args === 'object' && args !== null) {
                  args = JSON.stringify(args);
                }
                return `[Agent Tool Call: Executed "${name}" with args: ${args}]`;
              }).join('\n');
              
              content = (content + '\n' + callsDesc).trim();
            }
            
            cleanedMessages.push({
              role: 'assistant',
              content: content
            });
            
          } else if (role === 'tool') {
            const toolName = msg.name || 'tool';
            let resultStr = msg.content || '';
            if (typeof resultStr === 'object' && resultStr !== null) {
              resultStr = JSON.stringify(resultStr, null, 2);
            }
            
            cleanedMessages.push({
              role: 'user',
              content: `[System Tool Response for "${toolName}":\n${resultStr}]`,
              isToolResponse: true
            });
            
          } else {
            cleanedMessages.push({
              role: msg.role,
              content: (msg.role === 'system' && fullSystemInstruction) ? fullSystemInstruction : (msg.content || '')
            });
          }
        }
        
        // Merge consecutive same-role messages to guarantee strict role-alternation compliance
        const mergedMessages = [];
        for (const msg of cleanedMessages) {
          if (mergedMessages.length > 0 && mergedMessages[mergedMessages.length - 1].role === msg.role) {
            const lastMsg = mergedMessages[mergedMessages.length - 1];
            if (msg.content) {
              lastMsg.content = ((lastMsg.content || '') + '\n\n' + msg.content).trim();
            }
            if (msg.isToolResponse) {
              lastMsg.isToolResponse = true;
            }
          } else {
            mergedMessages.push({ ...msg });
          }
        }
        
        requestPayload.messages = mergedMessages;
        
        const textOnlyGuidance = `\n\nCRITICAL SYSTEM NOTICE: Native tool-calling is disabled for this model. When you need to invoke an action, you MUST write a standard JSON code block in your response. Example:\n\`\`\`json\n{\n  "name": "writeFile",\n  "arguments": {\n    "path": "hello.cpp",\n    "content": "#include <iostream>\\n\\nint main() {\\n    std::cout << \\"Hello, World!\\" << std::endl;\\n    return 0;\\n}"\n  }\n}\n\`\`\`\nIMPORTANT: Once a tool execution result has been returned to you in conversation history, do NOT output the JSON tool call block again! Simply reply to the user with your final answer and explanation in plain text.`;

        // Check if there is a system message to append to
        const systemMsg = requestPayload.messages.find(msg => msg.role === 'system');
        if (systemMsg) {
          systemMsg.content = (systemMsg.content || '') + textOnlyGuidance;
        }

        // Check if the conversation ends with a tool execution result
        const hasToolResultAtEnd = requestPayload.messages.length > 0 && requestPayload.messages[requestPayload.messages.length - 1].isToolResponse;

        // Also append an appropriate reminder to the end of the last real user message
        const realUserMessages = requestPayload.messages.filter(msg => msg.role === 'user' && !msg.isToolResponse);
        if (realUserMessages.length > 0) {
          const lastUserMsg = realUserMessages[realUserMessages.length - 1];
          if (hasToolResultAtEnd) {
            lastUserMsg.content = (lastUserMsg.content || '') + `\n\n(Notice: Tool execution has completed successfully. Please respond to the user with the result or summary. Do NOT repeat the previous tool call JSON block.)`;
          } else {
            lastUserMsg.content = (lastUserMsg.content || '') + `\n\n(Reminder: Please write the exact JSON code block to call your tools. Example: \`\`\`json\n{\n  "name": "writeFile",\n  "arguments": { "path": "hello.cpp", "content": "..." }\n}\n\`\`\`)`;
          }
        }

        // Clean up temporary isToolResponse flags
        for (const msg of requestPayload.messages) {
          delete msg.isToolResponse;
        }
      }
      
      if (isVerboseJsonEnabled()) {
        console.log(`${providerName} Retry Request Payload (no tools):`, JSON.stringify(requestPayload, null, 2));
      }

      const retryLoader = startSpinner(`Retrying in text-only mode ('${this.model}')...`);

      try {
        response = await fetch(requestUrl, {
          method: 'POST',
          headers: getOllamaHeaders(),
          body: JSON.stringify(requestPayload),
          signal: activeSignal
        });
      } finally {
        retryLoader.stop();
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`${providerName} API error (retry): ${response.status} ${response.statusText} - ${errText}`);
      }

      data = await parseResponseOrStream(response, provider, this.options?.onToken);
      if (data && data.error) {
        throw new Error(`${providerName} error (retry): ${data.error}`);
      }
    }

    // Auto-continue if response was truncated mid-sentence by context window / token limit (done_reason === 'length')
    let doneReason = data?.done_reason || data?.choices?.[0]?.finish_reason;
    let currentMsg = data?.message || data?.choices?.[0]?.message;
    let continuationCount = 0;
    const MAX_LENGTH_CONTINUATIONS = 2;

    while (
      doneReason === 'length' &&
      currentMsg &&
      (!currentMsg.tool_calls || currentMsg.tool_calls.length === 0) &&
      continuationCount < MAX_LENGTH_CONTINUATIONS &&
      (!activeSignal || !activeSignal.aborted)
    ) {
      continuationCount++;
      const partialContent = currentMsg.content || '';
      const compactedBase = compactMessagesForContextHeadroom(
        requestPayload.messages || [],
        requestPayload.options?.num_ctx || modelContextLength,
        requestPayload.tools,
        0,
        true
      );
      const continuationMessages = [...compactedBase];
      if (partialContent.trim()) {
        continuationMessages.push({
          role: 'assistant',
          content: partialContent
        });
        continuationMessages.push({
          role: 'user',
          content: 'Your previous response was cut off mid-sentence due to the context token limit. Continue writing from the exact word where you stopped without repeating what you already wrote, and emit any tool call needed to complete the step.'
        });
      } else {
        continuationMessages.push({
          role: 'user',
          content: 'Your previous thinking process reached the token limit before you output your response or tool call. Output your response and invoke the required tool call directly now.'
        });
      }

      const contPayload = {
        ...requestPayload,
        messages: continuationMessages
      };

      const contLoader = startSpinner(`Continuing truncated response ('${this.model}')...`);
      let contResponse;
      try {
        contResponse = await fetch(requestUrl, {
          method: 'POST',
          headers: getOllamaHeaders(),
          body: JSON.stringify(contPayload),
          signal: activeSignal
        });
      } catch {
        break;
      } finally {
        contLoader.stop();
      }

      if (!contResponse || !contResponse.ok) break;
      const contData = await parseResponseOrStream(contResponse, provider, this.options?.onToken);
      if (!contData || contData.error) break;

      const contMsg = contData.message || contData.choices?.[0]?.message;
      if (!contMsg) break;

      const addition = contMsg.content || '';
      if (partialContent && addition) {
        const needsSpace = !/\s$/.test(partialContent) && !/^\s/.test(addition) && !/^[.,;:!?)}\]]/.test(addition);
        currentMsg.content = partialContent + (needsSpace ? ' ' : '') + addition;
      } else {
        currentMsg.content = partialContent + addition;
      }

      if (contMsg.tool_calls && contMsg.tool_calls.length > 0) {
        currentMsg.tool_calls = contMsg.tool_calls;
      }
      const contThinking = contMsg.thinking || contMsg.reasoning || contMsg.reasoning_content;
      if (contThinking) {
        currentMsg.thinking = ((currentMsg.thinking || currentMsg.reasoning || '') + '\n' + contThinking).trim();
      }
      if (typeof contData.eval_count === 'number') {
        data.eval_count = (data.eval_count || 0) + contData.eval_count;
      }
      if (typeof contData.prompt_eval_count === 'number') {
        data.prompt_eval_count = contData.prompt_eval_count;
      }
      doneReason = contData.done_reason || contData.choices?.[0]?.finish_reason;
    }

    if (this.sessionId && typeof data?.prompt_eval_count === 'number') {
      sessionContextTokensMap.set(
        this.sessionId,
        data.prompt_eval_count + (typeof data.eval_count === 'number' ? data.eval_count : 0)
      );
    }

    if (isVerboseJsonEnabled()) {
      console.log(`${providerName} Response Payload:`, JSON.stringify(data, null, 2));
    }

    const message = data.message || data.choices?.[0]?.message;
    if (!message) {
      throw new Error(`Invalid or empty response from ${providerName}.`);
    }

    // Intercept any native or embedded images in the response to decode and save them
    const responseImages = message.images || data.images || [];
    let extractedBase64 = null;
    let foundEmbeddedImage = false;
    let extractedMimeType = 'image/png';

    if (Array.isArray(responseImages) && responseImages.length > 0) {
      const clean = responseImages[0].replace(/^data:image\/\w+;base64,/, '').replace(/\s/g, '');
      const buffer = Buffer.from(clean, 'base64');
      if (isValidImageBuffer(buffer)) {
        extractedBase64 = clean;
        foundEmbeddedImage = true;
        extractedMimeType = getImageMimeType(buffer);
      }
    }

    let text = message.content || '';

    let inputTokens = data.prompt_eval_count || data.usage?.prompt_tokens;
    let outputTokens = data.eval_count || data.usage?.completion_tokens;

    // Robust fallback estimation if token counts are missing/undefined
    if (typeof inputTokens !== 'number') {
      const payloadStr = JSON.stringify(requestPayload.messages || '');
      inputTokens = Math.ceil(payloadStr.length / 4);
    }
    if (typeof outputTokens !== 'number') {
      outputTokens = Math.ceil(text.length / 4);
    }

    addSessionTokens(inputTokens, outputTokens);

    if (!foundEmbeddedImage && text) {
      const dataUriMatch = text.match(/data:image\/([a-zA-Z0-9\-\+]+);base64,([A-Za-z0-9+/=\s]+)/i);
      if (dataUriMatch) {
        const clean = dataUriMatch[2].replace(/\s/g, '');
        const buffer = Buffer.from(clean, 'base64');
        if (isValidImageBuffer(buffer)) {
          extractedBase64 = clean;
          foundEmbeddedImage = true;
          extractedMimeType = `image/${dataUriMatch[1]}`;
        }
      }
      
      if (!foundEmbeddedImage) {
        const codeBlockMatch = text.match(/```(?:[a-zA-Z0-9_\-]+)?\s*([A-Za-z0-9+/=\s]{50,})\s*```/);
        if (codeBlockMatch) {
          const clean = codeBlockMatch[1].replace(/\s/g, '');
          const buffer = Buffer.from(clean, 'base64');
          if (isValidImageBuffer(buffer)) {
            extractedBase64 = clean;
            foundEmbeddedImage = true;
            extractedMimeType = getImageMimeType(buffer);
          }
        }
      }
      
      if (!foundEmbeddedImage) {
        const words = text.split(/\s+/);
        for (const word of words) {
          if (word.length >= 50 && /^[A-Za-z0-9+/=]+$/.test(word)) {
            const buffer = Buffer.from(word, 'base64');
            if (isValidImageBuffer(buffer)) {
              extractedBase64 = word;
              foundEmbeddedImage = true;
              extractedMimeType = getImageMimeType(buffer);
              break;
            }
          }
        }
      }
    }

    if (foundEmbeddedImage && extractedBase64) {
      let targetPath = 'ollama_response_image.png';
      for (const content of llmRequest.contents || []) {
        if (content.role === 'user') {
          for (const part of content.parts || []) {
            if (part.text) {
              const fileMatch = part.text.match(/([a-zA-Z0-9_\-\.\/]+\.(?:png|jpg|jpeg|gif|bmp))/i);
              if (fileMatch) {
                targetPath = fileMatch[1];
                break;
              }
            }
          }
        }
      }
      
      try {
        const resolvedPath = path.resolve(process.cwd(), targetPath);
        if (resolvedPath.startsWith(process.cwd())) {
          const buffer = Buffer.from(extractedBase64, 'base64');
          await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true });
          await fs.promises.writeFile(resolvedPath, buffer);
          console.log(`[Ollama ADK] Natively/embedded extracted and stored image from Ollama response to: ${targetPath}`);
        }

        if (this.sessionId) {
          try {
            const artifactPayload = {
              userId: 'default-user',
              sessionId: this.sessionId,
              filename: path.basename(targetPath),
              artifact: {
                inlineData: {
                  data: extractedBase64,
                  mimeType: extractedMimeType
                }
              }
            };
            const plumarArtifactService = new FileArtifactService(path.join(process.cwd(), '.plumar', 'sessions'));
            await plumarArtifactService.saveArtifact(artifactPayload);
            const legacyArtifactService = new FileArtifactService(path.join(process.cwd(), '.antigravitycli', 'sessions'));
            await legacyArtifactService.saveArtifact(artifactPayload);
            console.log(`[Ollama ADK] Successfully saved ADK image artifact to session folder for: ${targetPath}`);
          } catch (adkErr) {
            console.error(`[Ollama ADK] Failed to save image artifact via ADK:`, adkErr.message);
          }
        }
      } catch (err) {
        console.error(`[Ollama ADK] Failed to save image from Ollama response:`, err.message);
      }
    }
    
    const parts = [];
    
    if (foundEmbeddedImage && extractedBase64) {
      parts.push({
        inlineData: {
          data: extractedBase64,
          mimeType: extractedMimeType
        }
      });
    }
    
    // Parse any reasoning or thinking fields from Ollama (e.g. DeepSeek-R1 or Gemma4 thinking models)
    let combinedThoughtText = '';
    let reasoningText = message.reasoning || message.reasoning_content || message.thinking || '';
    const nativeToolCalls = message.tool_calls;
    const textToolCalls = [];
    const executeThinkingActive = isExecuteThinkingEnabled();

    if (reasoningText) {
      if (executeThinkingActive) {
        // When executeThinking is enabled in settings, split on </thinking> or <|thought|>
        // and extract any tool calls emitted inside the thinking stream.
        const closeThinkMatch = reasoningText.match(/([\s\S]*?)(?:<\/thinking>|<\|thought\|>|<thought\|>)([\s\S]*)/i);
        if (closeThinkMatch) {
          reasoningText = closeThinkMatch[1].replace(/^<thinking>\s*/i, '').trim();
          const leakedContent = closeThinkMatch[2].trim();
          if (leakedContent) {
            text = text ? `${leakedContent}\n${text}` : leakedContent;
          }
        }

        if (!nativeToolCalls || nativeToolCalls.length === 0) {
          const thoughtParsed = detectAndParseTextToolCalls(reasoningText, llmRequest.contents, null, true);
          if (thoughtParsed.calls.length > 0) {
            reasoningText = thoughtParsed.text;
            textToolCalls.push(...thoughtParsed.calls);
          }
        }

        reasoningText = reasoningText
          .replace(/<\/?thinking>/gi, '')
          .replace(/<\|?tool_response\|?>/gi, '')
          .replace(/<\|?tool_call\|?>/gi, '')
          .trim();
      } else {
        reasoningText = reasoningText.trim();
      }

      if (reasoningText) {
        combinedThoughtText = reasoningText;
        parts.push({
          text: reasoningText,
          thought: true
        });
      }
    }

    // Parse Ollama model thinking process tag (<thinking>...</thinking> or "Thinking Process:" block) inside content
    const thinkingMatch =
      text.match(/<thinking>([\s\S]*?)<\/thinking>/i) ||
      text.match(/^\s*(?:Thinking Process|Thought Process):\s*([\s\S]*?)<\/thinking>/i) ||
      (!text.includes('<thinking>') && text.includes('</thinking>') ? text.match(/^([\s\S]*?)<\/thinking>/i) : null) ||
      text.match(/^\s*(?:Thinking Process|Thought Process):[ \t]*\r?\n([\s\S]+)$/i);

    if (thinkingMatch) {
      let thoughtText = thinkingMatch[1].replace(/^\s*(?:Thinking Process|Thought Process):\s*/i, '').trim();
      if (executeThinkingActive && (!nativeToolCalls || nativeToolCalls.length === 0)) {
        const thoughtParsed = detectAndParseTextToolCalls(thoughtText, llmRequest.contents, null, true);
        if (thoughtParsed.calls.length > 0) {
          thoughtText = thoughtParsed.text;
          textToolCalls.push(...thoughtParsed.calls);
        }
      }
      if (thoughtText) {
        combinedThoughtText = combinedThoughtText ? (combinedThoughtText + '\n' + thoughtText) : thoughtText;
        parts.push({
          text: thoughtText,
          thought: true
        });
      }
      text = text.replace(thinkingMatch[0], '').trim();
    }
    
    // Parse any text-based tool calls if no native tool calls are present
    if (!nativeToolCalls || nativeToolCalls.length === 0) {
      const parsed = detectAndParseTextToolCalls(text, llmRequest.contents, textToolCalls.length === 0 ? combinedThoughtText : null);
      text = parsed.text;
      textToolCalls.push(...parsed.calls);

      // Filter out text tool calls that are merely echoing completed tool calls from the immediate prior step
      if (textToolCalls.length > 0 && Array.isArray(llmRequest.contents) && llmRequest.contents.length > 0) {
        const lastContent = llmRequest.contents[llmRequest.contents.length - 1];
        const hasPrecedingToolResponse = (lastContent.parts || []).some(p => p.functionResponse);
        if (hasPrecedingToolResponse) {
          // Only check immediately preceding function calls from the step right before
          const prevContent = llmRequest.contents.length >= 2 ? llmRequest.contents[llmRequest.contents.length - 2] : null;
          const immediateCalls = prevContent ? (prevContent.parts || []).filter(p => p.functionCall).map(p => p.functionCall) : [];
          
          // Never filter out file mutation / write tools (e.g. writeFile, appendFile, searchReplace, codeFixer)
          const isWriteTool = (name) => ['writeFile', 'writeBinaryFile', 'writeMarkdown', 'appendFile', 'searchReplace', 'codeFixer'].includes(name);

          const filteredCalls = [];
          for (const call of textToolCalls) {
            // Write tools must always execute to ensure files are actually updated
            if (isWriteTool(call.name)) {
              filteredCalls.push(call);
              continue;
            }
            const callArgsStr = JSON.stringify(call.args || {});
            const alreadyExecuted = immediateCalls.some(prev => 
              prev.name === call.name && JSON.stringify(prev.args || {}) === callArgsStr
            );
            if (!alreadyExecuted) {
              filteredCalls.push(call);
            }
          }
          textToolCalls.length = 0;
          textToolCalls.push(...filteredCalls);
        }
      }
    }
    
    if (text) {
      parts.push({ text });
    }
    
    if (nativeToolCalls && nativeToolCalls.length > 0) {
      for (const call of nativeToolCalls) {
        const fnObj = call.function || call;
        let parsedArgs = fnObj.arguments !== undefined ? fnObj.arguments : (fnObj.parameters || fnObj.args || {});
        if (typeof parsedArgs === 'string') {
          try {
            parsedArgs = JSON.parse(parsedArgs);
          } catch (e) {
            parsedArgs = parseRelaxedJson(parsedArgs) || {};
          }
        }
        if (!parsedArgs || typeof parsedArgs !== 'object') {
          parsedArgs = {};
        }
        parts.push({
          functionCall: {
            name: fnObj.name || call.name,
            args: parsedArgs
          }
        });
      }
    } else if (textToolCalls.length > 0) {
      for (const call of textToolCalls) {
        parts.push({
          functionCall: {
            name: call.name,
            args: call.args
          }
        });
      }
    }
    
    const hasContent = text.trim() || 
                       reasoningText || 
                       thinkingMatch || 
                       (nativeToolCalls && nativeToolCalls.length > 0) || 
                       (textToolCalls && textToolCalls.length > 0) ||
                       foundEmbeddedImage;
                       
    if (!hasContent) {
      throw new Error(`The local model '${this.model}' returned a completely empty response. This often happens if the model's parameters (e.g. context limit 'num_ctx', temperature, or system prompt length) are misconfigured, or if the model's local context window was exceeded.`);
    }
    
    yield {
      content: {
        role: 'model',
        parts: parts
      }
    };
  }

  async connect(llmRequest) {
    throw new Error('Live connection is not supported by Ollama.');
  }
}

/**
 * Fetch available models from the local Ollama or LM Studio instance
 * @param {boolean} [detailed=false] If true, returns full model metadata objects. If false, returns model name strings.
 * @param {string|null} [targetProvider=null] Optional explicit provider ('ollama' | 'lmstudio') to avoid mutating global provider state during concurrent discovery.
 * @returns {Promise<Array<string|object>>} List of model names or model objects
 */
export async function fetchOllamaModels(detailed = false, targetProvider = null) {
  const provider = targetProvider || getLlmProvider();
  const providerName = provider === 'lmstudio' ? 'LM Studio' : 'Ollama';
  const baseUrl = getOllamaBaseUrl(provider);
  const headers = getOllamaHeaders(provider);
  const modelsLoader = startSpinner(`Fetching installed models from ${providerName}...`);
  try {
    let response;
    try {
      if (provider === 'lmstudio') {
        let url = baseUrl;
        if (!url.endsWith('/v1') && !url.includes('/v1/')) {
          url = url + '/v1';
        }
        response = await fetch(`${url}/models`, {
          headers,
          signal: AbortSignal.timeout(5000)
        });
      } else {
        response = await fetch(`${baseUrl}/api/tags`, {
          headers,
          signal: AbortSignal.timeout(5000)
        });
      }
    } finally {
      modelsLoader.stop();
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    
    if (provider === 'lmstudio') {
      if (!data.data || data.data.length === 0) {
        return [];
      }
      if (detailed) {
        // Map LM Studio models to standard schema { name: id }
        return data.data.map(m => ({ name: m.id, id: m.id, details: { family: '', families: [] } }));
      }
      return data.data.map(m => m.id);
    } else {
      if (!data.models || data.models.length === 0) {
        return [];
      }
      if (detailed) {
        return data.models;
      }
      return data.models.map(m => m.name);
    }
  } catch (error) {
    throw new Error(`${providerName} API at ${baseUrl} is unreachable or non-responsive. Please make sure ${providerName} is running and accessible.`);
  }
}
