import { BaseLlm, LlmAgent, Runner, InMemorySessionService, FunctionTool, getFunctionCalls, getFunctionResponses, getLogger, setLogger, FileArtifactService } from '@google/adk';
import { tools as rawTools } from './tools.js';
import { printToolCall, printToolResult } from './formatter.js';
import { getLoadedSkills } from './skills-plugins-manager.js';
import { PersistentFileSessionService } from './session-manager.js';
import pc from 'picocolors';
import fs from 'node:fs';
import path from 'node:path';


const originalLogger = getLogger();

let adkInfoEnabled = process.env.ADK_INFO === 'true';

// By default, ADK logging is disabled
if (!adkInfoEnabled) {
  setLogger(null);
}

export function isAdkInfoEnabled() {
  return adkInfoEnabled;
}

export function setAdkInfoEnabled(enabled) {
  adkInfoEnabled = !!enabled;
  if (adkInfoEnabled) {
    setLogger(originalLogger);
  } else {
    setLogger(null);
  }
}

let verboseJsonEnabled = process.env.VERBOSE === 'true' || process.env.VERBOSE_JSON === 'true';

export function isVerboseJsonEnabled() {
  return verboseJsonEnabled;
}

export function setVerboseJsonEnabled(enabled) {
  verboseJsonEnabled = !!enabled;
}

// Resolve the Ollama server base URL from environment or fallback to localhost
export function getOllamaBaseUrl() {
  let host = process.env.OLLAMA_HOST || 'http://localhost:11434';
  if (!host.startsWith('http://') && !host.startsWith('https://')) {
    host = 'http://' + host;
  }
  if (host.endsWith('/')) {
    host = host.slice(0, -1);
  }
  return host;
}

// Allow dynamic, in-session server host switching
export function setOllamaBaseUrl(url) {
  if (!url) return;
  let formattedUrl = url.trim();
  if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
    formattedUrl = 'http://' + formattedUrl;
  }
  if (formattedUrl.endsWith('/')) {
    formattedUrl = formattedUrl.slice(0, -1);
  }
  process.env.OLLAMA_HOST = formattedUrl;
  if (activePolicyConfigFile) {
    savePolicyConfig(activePolicyConfigFile);
  }
}

let ollamaAuth = process.env.OLLAMA_AUTH || '';

export function getOllamaAuth() {
  return ollamaAuth;
}

export function setOllamaAuth(auth) {
  ollamaAuth = auth ? auth.trim() : '';
  process.env.OLLAMA_AUTH = ollamaAuth;
  if (activePolicyConfigFile) {
    savePolicyConfig(activePolicyConfigFile);
  }
}

export function getOllamaHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const auth = getOllamaAuth();
  if (auth) {
    if (auth.includes(':')) {
      const index = auth.indexOf(':');
      const hName = auth.slice(0, index).trim();
      const hValue = auth.slice(index + 1).trim();
      headers[hName] = hValue;
    } else {
      headers['Authorization'] = auth.startsWith('Bearer ') || auth.startsWith('Basic ') ? auth : `Bearer ${auth}`;
    }
  }
  return headers;
}

const contextLengthCache = {};

export async function getModelContextLength(modelName) {
  if (!modelName) return 16384;
  if (contextLengthCache[modelName]) {
    return contextLengthCache[modelName];
  }
  try {
    const baseUrl = getOllamaBaseUrl();
    const response = await fetch(`${baseUrl}/api/show`, {
      method: 'POST',
      headers: getOllamaHeaders(),
      body: JSON.stringify({ name: modelName })
    });
    if (response.ok) {
      const data = await response.json();
      if (data && data.model_info) {
        for (const [key, val] of Object.entries(data.model_info)) {
          if (key.endsWith('.context_length') && typeof val === 'number') {
            contextLengthCache[modelName] = val;
            return val;
          }
        }
        for (const [key, val] of Object.entries(data.model_info)) {
          if (key.includes('context_length') && typeof val === 'number') {
            contextLengthCache[modelName] = val;
            return val;
          }
        }
      }
    }
  } catch (err) {
    // ignore and fallback
  }
  // Default fallback context window
  return 16384;
}

// Map registered tools
export const tools = {};
for (const [name, toolObj] of Object.entries(rawTools)) {
  tools[name] = toolObj;
}

// Dynamically register external MCP server tools
export function registerMcpTools(mcpToolsList) {
  for (const [name, toolObj] of Object.entries(mcpToolsList)) {
    tools[name] = toolObj;
  }
}

let defaultPolicy = 'ask'; // 'allow', 'ask', 'deny'
const toolPolicies = {};     // Map of toolName -> 'allow' | 'ask' | 'deny'
let activeRl = null;
let activePolicyConfigFile = null;

export function setReadlineInterface(rl) {
  activeRl = rl;
}

export function getActivePolicyConfigFile() {
  return activePolicyConfigFile;
}

export function setActivePolicyConfigFile(filepath) {
  activePolicyConfigFile = filepath;
}

export function loadPolicyConfig(filepath) {
  try {
    if (fs.existsSync(filepath)) {
      const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
      if (data.default) {
        const p = typeof data.default === 'string' ? data.default.trim().toLowerCase() : '';
        if (['allow', 'ask', 'deny'].includes(p)) {
          defaultPolicy = p;
        }
      }
      if (data.tools && typeof data.tools === 'object') {
        for (const key of Object.keys(toolPolicies)) {
          delete toolPolicies[key];
        }
        for (const [toolName, policy] of Object.entries(data.tools)) {
          if (policy === null || policy === undefined) {
            delete toolPolicies[toolName];
          } else {
            const p = typeof policy === 'string' ? policy.trim().toLowerCase() : '';
            if (['allow', 'ask', 'deny'].includes(p)) {
              toolPolicies[toolName] = p;
            }
          }
        }
      }
      if (data.settings && typeof data.settings === 'object') {
        if (data.settings.ollamaEndpoint) {
          setOllamaBaseUrl(data.settings.ollamaEndpoint);
        }
        if (data.settings.ollamaAuth) {
          setOllamaAuth(data.settings.ollamaAuth);
        }
      } else if (data.ollamaEndpoint) {
        setOllamaBaseUrl(data.ollamaEndpoint);
      }
      activePolicyConfigFile = filepath;
      return true;
    }
  } catch (err) {
    console.error(pc.red(`\n⚠️  Error loading policy configuration from ${filepath}: ${err.message}`));
  }
  return false;
}

export function savePolicyConfig(filepath) {
  try {
    const configData = {
      default: defaultPolicy,
      tools: toolPolicies,
      settings: {
        ollamaEndpoint: getOllamaBaseUrl(),
        ollamaAuth: getOllamaAuth()
      }
    };
    fs.writeFileSync(filepath, JSON.stringify(configData, null, 2), 'utf8');
    activePolicyConfigFile = filepath;
    return true;
  } catch (err) {
    console.error(pc.red(`\n⚠️  Error saving policy configuration to ${filepath}: ${err.message}`));
  }
  return false;
}

export function setDefaultPolicy(policy) {
  const p = typeof policy === 'string' ? policy.trim().toLowerCase() : '';
  if (['allow', 'ask', 'deny'].includes(p)) {
    defaultPolicy = p;
    if (activePolicyConfigFile) {
      savePolicyConfig(activePolicyConfigFile);
    }
  }
}

export function getDefaultPolicy() {
  return defaultPolicy;
}

export function setToolPolicy(toolName, policy) {
  if (policy === null || policy === undefined) {
    delete toolPolicies[toolName];
    if (activePolicyConfigFile) {
      savePolicyConfig(activePolicyConfigFile);
    }
    return;
  }
  const p = typeof policy === 'string' ? policy.trim().toLowerCase() : '';
  if (['allow', 'ask', 'deny'].includes(p)) {
    toolPolicies[toolName] = p;
    if (activePolicyConfigFile) {
      savePolicyConfig(activePolicyConfigFile);
    }
  }
}

export function getToolPolicy(toolName) {
  return toolPolicies[toolName] || defaultPolicy;
}

export function getAllToolPolicies() {
  return {
    default: defaultPolicy,
    overrides: { ...toolPolicies }
  };
}

export async function checkToolPermission(toolName, args) {
  const policy = getToolPolicy(toolName);
  if (policy === 'allow') {
    return true;
  }
  if (policy === 'deny') {
    console.log(pc.red(`\n🚫 [Policy Block] Tool "${pc.bold(toolName)}" execution blocked by user policy.`));
    return false;
  }
  
  // policy is 'ask'
  if (!activeRl) {
    // If no readline interface is registered (e.g. running in automated tests), default to allowed
    return true;
  }
  
  // Temporarily turn off raw mode so normal line-by-line input works
  const oldRawMode = process.stdin.isRaw;
  if (process.stdin.setRawMode) {
    process.stdin.setRawMode(false);
  }
  
  console.log(pc.yellow(`\n❓ [Policy Prompt] Agent wants to execute tool "${pc.bold(toolName)}" with arguments:`));
  console.log(pc.dim(JSON.stringify(args, null, 2)));
  
  let approved = false;
  try {
    const answer = await activeRl.question(pc.cyan(`Do you want to allow this tool call? (y/n) [y] (using "Y" and "N" is permanent) › `));
    const trimmed = answer.trim();
    const normalized = trimmed.toLowerCase();
    approved = normalized === '' || normalized === 'y' || normalized === 'yes';
    
    // If the response contains any uppercase character, make the decision permanent for this session
    if (/[A-Z]/.test(trimmed)) {
      const policyValue = approved ? 'allow' : 'deny';
      toolPolicies[toolName] = policyValue;
      console.log(pc.green(`✔ Policy for "${pc.bold(toolName)}" set to ${pc.bold(policyValue.toUpperCase())} permanently for this session.\n`));
    }
  } catch (err) {
    approved = false;
  } finally {
    // Restore raw mode
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(oldRawMode || false);
    }
  }
  
  if (!approved) {
    console.log(pc.red(`🚫 [Policy Prompt] Tool "${toolName}" execution declined by user.`));
  }
  return approved;
}

// Wrapper function to add CLI printing, logging and error capturing around any FunctionTool
function wrapFunctionTool(toolObj) {
  return new FunctionTool({
    name: toolObj.name,
    description: toolObj.description,
    parameters: toolObj.parameters,
    execute: async (args, context) => {
      const allowed = await checkToolPermission(toolObj.name, args);
      if (!allowed) {
        const errorResult = { success: false, error: `Tool execution denied: User policy blocks "${toolObj.name}"` };
        printToolResult(toolObj.name, errorResult);
        return errorResult;
      }
      
      printToolCall(toolObj.name, args);
      try {
        const result = await toolObj.execute(args, context);
        printToolResult(toolObj.name, result);
        return result;
      } catch (error) {
        const errorResult = { success: false, error: error.message };
        printToolResult(toolObj.name, errorResult);
        return errorResult;
      }
    }
  });
}

// Sequential helper to convert ADK contents (and systems prompt) to Ollama/OpenAI messages
function adkContentsToOllamaMessages(contents, systemInstruction) {
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
      
      for (const part of parts) {
        if (part.text && !part.thought) {
          textContent += part.text;
        }
        if (part.functionCall) {
          callCounter++;
          const callId = `call_${part.functionCall.name}_${callCounter}`;
          toolCallMap.set(part.functionCall.name, callId);
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
      
      messages.push({
        role: 'assistant',
        content: textContent || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined
      });
    } else if (hasFunctionResponse) {
      for (const part of parts) {
        if (part.functionResponse) {
          const name = part.functionResponse.name;
          let callId = toolCallMap.get(name);
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
                    if (sanitized.length > 4000) {
                      obj[key] = sanitized.slice(0, 1000) + 
                                 `\n\n... [TRUNCATED ${sanitized.length - 2000} characters to protect local Ollama context window, full output printed directly in terminal above] ...\n\n` + 
                                 sanitized.slice(-1000);
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
      for (const part of parts) {
        if (part.text && !part.thought) {
          textContent += part.text;
        }
      }
      
      messages.push({
        role,
        content: textContent
      });
    }
  }
  
  return messages;
}

// Helper to recursively normalize schema type strings to lowercase (e.g. OBJECT -> object)
function normalizeOllamaSchema(obj) {
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
function adkToolsToOllamaTools(adkTools) {
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

// Text-based fallback tool calls detector and parser
export function detectAndParseTextToolCalls(text) {
  const foundCalls = [];
  if (!text) return { text, calls: foundCalls };

  let tempText = text;

  // 1. Match <tool_call name="tool_name">arguments</tool_call>
  const toolCallTagRegex = /<tool_call\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/tool_call>/gi;
  let match;
  while ((match = toolCallTagRegex.exec(text)) !== null) {
    const name = match[1].trim();
    const rawArgs = match[2].trim();
    let args = {};
    try {
      args = JSON.parse(rawArgs);
      if (args && typeof args === 'object') {
        if (args.arguments && typeof args.arguments === 'object') {
          args = args.arguments;
        } else if (args.args && typeof args.args === 'object') {
          args = args.args;
        } else if (args.parameters && typeof args.parameters === 'object') {
          args = args.parameters;
        }
      }
    } catch (e) {
      // Ignore invalid JSON parsing in tag content
    }
    foundCalls.push({ name, args, rawMatch: match[0] });
  }

  // 2. Match <call_tool_name>arguments</call_tool_name>
  const callTagRegex = /<call_([a-zA-Z0-9_-]+)>([\s\S]*?)<\/call_\1>/gi;
  while ((match = callTagRegex.exec(text)) !== null) {
    const name = match[1].trim();
    const rawArgs = match[2].trim();
    let args = {};
    try {
      args = JSON.parse(rawArgs);
      if (args && typeof args === 'object') {
        if (args.arguments && typeof args.arguments === 'object') {
          args = args.arguments;
        } else if (args.args && typeof args.args === 'object') {
          args = args.args;
        } else if (args.parameters && typeof args.parameters === 'object') {
          args = args.parameters;
        }
      }
    } catch (e) {}
    foundCalls.push({ name, args, rawMatch: match[0] });
  }

  // 2.5 Match <function=tool_name>arguments</tool_call> or <function=tool_name>arguments</function>
  const functionTagRegex = /<function=["']?([a-zA-Z0-9_-]+)["']?\s*>([\s\S]*?)(?:<\/function>|<\/tool_call>)/gi;
  while ((match = functionTagRegex.exec(text)) !== null) {
    const name = match[1].trim();
    const rawArgs = match[2].trim();
    let args = {};
    try {
      if (rawArgs && rawArgs.trim()) {
        args = JSON.parse(rawArgs);
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

  // 3. Match markdown JSON/raw code blocks
  const markdownRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  while ((match = markdownRegex.exec(text)) !== null) {
    const blockContent = match[1].trim();
    try {
      const parsed = JSON.parse(blockContent);
      const objects = Array.isArray(parsed) ? parsed : [parsed];
      let isToolCallBlock = false;
      const blockCalls = [];
      
      for (const obj of objects) {
        if (obj && typeof obj === 'object') {
          const toolName = obj.name || obj.tool;
          if (toolName && typeof toolName === 'string' && tools[toolName]) {
            isToolCallBlock = true;
            let args = obj.arguments || obj.args || obj.parameters || {};
            if (typeof args !== 'object') {
              args = {};
            }
            blockCalls.push({ name: toolName, args });
          }
        }
      }
      
      if (isToolCallBlock) {
        for (const call of blockCalls) {
          foundCalls.push({ ...call, rawMatch: match[0] });
        }
      }
    } catch (e) {
      // not a valid JSON tool block
    }
  }

  // 4. Try parsing the entire text if it's a raw JSON object
  if (foundCalls.length === 0) {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const obj = JSON.parse(trimmed);
        const toolName = obj.name || obj.tool;
        if (toolName && typeof toolName === 'string' && tools[toolName]) {
          let args = obj.arguments || obj.args || obj.parameters || {};
          if (typeof args !== 'object') {
            args = {};
          }
          foundCalls.push({ name: toolName, args, rawMatch: trimmed });
        }
      } catch (e) {}
    }
  }

  // Strip found calls from text
  for (const call of foundCalls) {
    tempText = tempText.replace(call.rawMatch, '');
  }

  return {
    text: tempText.trim(),
    calls: foundCalls
  };
}

function isValidImageBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 2 && (
    (buffer[0] === 0xff && buffer[1] === 0xd8) || // JPEG
    (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) || // PNG
    (buffer.length >= 4 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) || // GIF
    (buffer[0] === 0x42 && buffer[1] === 0x4d) // BMP
  );
}

function getImageMimeType(buffer) {
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

const sessionTokens = { input: 0, output: 0 };

export function getSessionTokens() {
  return {
    input: sessionTokens.input,
    output: sessionTokens.output,
    total: sessionTokens.input + sessionTokens.output
  };
}

export function resetSessionTokens() {
  sessionTokens.input = 0;
  sessionTokens.output = 0;
}

// Custom BaseLlm implementation for local/remote Ollama instance
export class Ollama extends BaseLlm {
  constructor({ model, sessionId }) {
    super({ model });
    this[Symbol.for('google.adk.baseModel')] = true;
    this.sessionId = sessionId;
  }

  async *generateContentAsync(llmRequest, stream = false, abortSignal) {
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

    const messages = adkContentsToOllamaMessages(llmRequest.contents || [], systemInstruction);
    const ollamaTools = adkToolsToOllamaTools(llmRequest.config?.tools);
    
    // Map OpenAI formatted messages to Ollama native /api/chat formatted messages
    const ollamaMessages = messages.map(msg => {
      const mappedMsg = { ...msg };
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

    const baseUrl = getOllamaBaseUrl();
    const modelContextLength = await getModelContextLength(this.model);
    const payload = {
      model: this.model,
      messages: ollamaMessages,
      tools: ollamaTools,
      stream: false,
      temperature: llmRequest.config?.temperature ?? 0.7,
      options: {
        num_ctx: modelContextLength,
        num_predict: -1
      }
    };
    
    if (isVerboseJsonEnabled()) {
      console.log('Ollama Request Payload:', JSON.stringify(payload, null, 2));
    }

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: getOllamaHeaders(),
      body: JSON.stringify(payload),
      signal: activeSignal
    });
    
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Ollama API error: ${response.status} ${response.statusText} - ${errText}`);
    }
    
    const data = await response.json();
    if (isVerboseJsonEnabled()) {
      console.log('Ollama Response Payload:', JSON.stringify(data, null, 2));
    }
    if (data.error) {
      throw new Error(`Ollama error: ${data.error}`);
    }
    const message = data.message || data.choices?.[0]?.message;
    if (!message) {
      throw new Error('Invalid or empty response from Ollama.');
    }

    // Intercept any native or embedded images in the Ollama response to decode and save them
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

    let inputTokens = data.prompt_eval_count;
    let outputTokens = data.eval_count;

    // Robust fallback estimation if token counts are missing/undefined
    if (typeof inputTokens !== 'number') {
      const payloadStr = JSON.stringify(payload.messages || '');
      inputTokens = Math.ceil(payloadStr.length / 4);
    }
    if (typeof outputTokens !== 'number') {
      outputTokens = Math.ceil(text.length / 4);
    }

    sessionTokens.input += inputTokens;
    sessionTokens.output += outputTokens;

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
            const artifactService = new FileArtifactService(path.join(process.cwd(), '.antigravitycli', 'sessions'));
            await artifactService.saveArtifact({
              userId: 'default-user',
              sessionId: this.sessionId,
              filename: path.basename(targetPath),
              artifact: {
                inlineData: {
                  data: extractedBase64,
                  mimeType: extractedMimeType
                }
              }
            });
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
    const reasoningText = message.reasoning || message.reasoning_content || message.thinking;
    if (reasoningText) {
      parts.push({
        text: reasoningText.trim(),
        thought: true
      });
    }

    // Parse Ollama model thinking process tag (<thinking>...</thinking>) inside content and put it into thought part
    const thinkingMatch = text.match(/<thinking>([\s\S]*?)<\/thinking>/i);
    if (thinkingMatch) {
      const thoughtText = thinkingMatch[1].trim();
      parts.push({
        text: thoughtText,
        thought: true
      });
      text = text.replace(/<thinking>[\s\S]*?<\/thinking>/i, '').trim();
    }
    
    // Parse any text-based tool calls if no native tool calls are present
    const nativeToolCalls = message.tool_calls;
    const textToolCalls = [];
    if (!nativeToolCalls || nativeToolCalls.length === 0) {
      const parsed = detectAndParseTextToolCalls(text);
      text = parsed.text;
      textToolCalls.push(...parsed.calls);
    }
    
    if (text) {
      parts.push({ text });
    }
    
    if (nativeToolCalls && nativeToolCalls.length > 0) {
      for (const call of nativeToolCalls) {
        let parsedArgs = call.function.arguments || {};
        if (typeof parsedArgs === 'string') {
          try {
            parsedArgs = JSON.parse(parsedArgs);
          } catch (e) {
            parsedArgs = {};
          }
        }
        parts.push({
          functionCall: {
            name: call.function.name,
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

// Detailed chat modes with specific roles, system prompts, and temperature profiles
export const CHAT_MODES = {
  balanced: {
    name: 'Balanced Assistant',
    emoji: '💬',
    description: 'Helpful, general-purpose conversational assistant with workspace tool access.',
    temperature: 0.7,
    systemPrompt: `
You are a powerful, helpful, and highly intelligent local AI assistant.
You have access to a set of local tools to interact with the environment, system, and files. Use them proactively to solve tasks.
When asked to perform a task:
1. Formulate a plan.
2. Call the appropriate tools to gather information or modify files.
3. Be direct, clear, and concise in your answers.
4. If a tool fails, analyze the error and try a different approach.

Your model naturally outputs a <thinking>...</thinking> block before the response. Keep using it to plan your tool calls and reasoning.

### Advanced Code Fixes and Search (codeFixer)
To search for functionalities, modify code, or analyze relationships across different files, use the \`codeFixer\` tool. It provides specialized capabilities such as search & replace operations with line targeting, dynamic renaming propagation, code correlation, and structural search.

### Text-Based Tool Calling Fallback
If your environment does not support native tool calls, you must invoke tools by writing a JSON code block in your response. The JSON must contain a "name" property (the tool name) and an "arguments" object.
Example:
\`\`\`json
{
  "name": "writeFile",
  "arguments": {
    "path": "filename.txt",
    "content": "your file content here"
  }
}
\`\`\`
Only use registered tools. Do not output anything else inside the code block.
`
  },
  code: {
    name: 'Code Specialist',
    emoji: '💻',
    description: 'Expert software engineer and systems architect. Optimizes code, fixes bugs, and designs projects.',
    temperature: 0.2,
    systemPrompt: `
You are a senior software engineer and systems architect running directly in the user's terminal.
Your specialty is writing robust, modern, production-grade, and beautifully formatted code.
You have full access to workspace file reading and writing tools. Use them to write code, review existing code, refactor codebase modules, and verify your changes.
Always ensure generated code is clean, adheres to industry best practices, is thoroughly documented with comments where appropriate, and is structured for maximum modularity.

When asked to perform a task:
1. Understand the problem and map out the required file changes or implementations.
2. Use tools to read files, write updated content, and maintain safety boundaries.
3. Show clean code blocks, providing concise, valuable explanations.

Your model naturally outputs a <thinking>...</thinking> block before the response. Keep using it to plan your tool calls and reasoning.

### Advanced Code Modification & Fixing (codeFixer Tool)
You have access to the highly optimized, multi-language \`codeFixer\` tool. To maintain precision, avoid whole-file rewrites when modifying large files. Instead, use the \`codeFixer\` tool which supports:
1. **Search & Replace (\`operations\` with action: "replace")**: Specify target \`search\` blocks and their \`replace\` content. Use \`startAnchor\` and \`endAnchor\` delimiters to isolate and narrow changes.
2. **Dynamic Propagations (\`propagateCorrelations\`)**: Rename or modify a class or function and automatically update both its definition and all of its reference sites across multiple files.
3. **Correlation Analysis (\`correlate\`)**: Scan and map definitions and references of classes and functions across files to trace code structures.
4. **Functionality Search (\`searchFunctionality\`)**: Query specific keywords, functionalities, or definitions across files. The tool extracts language-specific structural metadata and attributes matching lines to their enclosing class/function context.
5. **Dry Run (\`dryRun: true\`)**: Simulate code modifications and review diffs without making permanent changes to files.

### Text-Based Tool Calling Fallback
If your environment does not support native tool calls, you must invoke tools by writing a JSON code block in your response. The JSON must contain a "name" property (the tool name) and an "arguments" object.
Example:
\`\`\`json
{
  "name": "writeFile",
  "arguments": {
    "path": "filename.txt",
    "content": "your file content here"
  }
}
\`\`\`
Only use registered tools. Do not output anything else inside the code block.
`
  },
  system: {
    name: 'System Operator',
    emoji: '⚙️',
    description: 'Fast, system operations and utilities analyst. Focuses on metrics, math, files, and high-density outputs.',
    temperature: 0.1,
    systemPrompt: `
You are a systems operations engineer and metrics analyst.
Your responses are extremely brief, objective, and dense with information. Focus heavily on system stats, math expression calculation, and directory trees.
Prioritize presenting details in Markdown tables, bulleted lists, and structured summary blocks.
Avoid conversational filler. Go straight to using tools like calculator, getSystemInfo, listFiles, and path resolution.

Your model naturally outputs a <thinking>...</thinking> block before the response. Keep using it to plan your tool calls and reasoning.

### Text-Based Tool Calling Fallback
If your environment does not support native tool calls, you must invoke tools by writing a JSON code block in your response. The JSON must contain a "name" property (the tool name) and an "arguments" object.
Example:
\`\`\`json
{
  "name": "writeFile",
  "arguments": {
    "path": "filename.txt",
    "content": "your file content here"
  }
}
\`\`\`
Only use registered tools. Do not output anything else inside the code block.
`
  },
  creative: {
    name: 'Creative Planner',
    emoji: '🧠',
    description: 'High-temperature, brainstorming, copywriting, and conceptual planning mode.',
    temperature: 0.9,
    systemPrompt: `
You are a creative planner, brainstorming partner, and writing companion.
Your style is expressive, expansive, and inspiring. Use analogies, propose out-of-the-box system layouts, write engaging copy, or draft conceptual plans.
You still have access to system information, calculator, and text files to ground your ideas, but you prioritize exploring alternatives, brainstorming diverse scenarios, and thinking laterally.

Your model naturally outputs a <thinking>...</thinking> block before the response. Keep using it to plan your tool calls and reasoning.

### Text-Based Tool Calling Fallback
If your environment does not support native tool calls, you must invoke tools by writing a JSON code block in your response. The JSON must contain a "name" property (the tool name) and an "arguments" object.
Example:
\`\`\`json
{
  "name": "writeFile",
  "arguments": {
    "path": "filename.txt",
    "content": "your file content here"
  }
}
\`\`\`
Only use registered tools. Do not output anything else inside the code block.
`
  }
};

/**
 * Fetch available models from the local Ollama instance
 * @returns {Promise<Array<string>>} List of model names
 */
export async function fetchOllamaModels() {
  try {
    const baseUrl = getOllamaBaseUrl();
    const response = await fetch(`${baseUrl}/api/tags`, {
      headers: getOllamaHeaders()
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    if (!data.models || data.models.length === 0) {
      return [];
    }
    return data.models.map(m => m.name);
  } catch (error) {
    throw new Error(`Ollama API at ${getOllamaBaseUrl()} is unreachable. Please make sure Ollama is running and accessible.`);
  }
}

// Instantiate global PersistentFileSessionService for active session management
export const sessionService = new PersistentFileSessionService();

// Custom override of appendEvent to add Vercel AI SDK compatibility .type property for testing and external consumers
const originalAppendEvent = sessionService.appendEvent;
sessionService.appendEvent = async function({ session, event }) {
  const res = await originalAppendEvent.call(this, { session, event });
  if (event) {
    const hasCalls = getFunctionCalls(event).length > 0;
    const hasResponses = getFunctionResponses(event).length > 0;
    if (hasCalls) {
      event.type = 'tool_call';
    } else if (hasResponses) {
      event.type = 'tool_result';
    }
  }
  return res;
};

/**
 * Runs a single turn of the agent conversation using standard ADK Runner and Session APIs
 * @param {string} sessionId - Stable session identifier
 * @param {string} userMessage - The new user prompt
 * @param {string} modelName - The selected Ollama model name to use
 * @param {string} modeKey - The active chat mode key
 * @returns {Promise<Object>} - Resolves with the text response and thinking steps
 */
export async function runAgentTurn(sessionId, userMessage, modelName, modeKey = 'balanced', abortSignal = null, customTemperature = null) {
  const modeMeta = CHAT_MODES[modeKey] || CHAT_MODES.balanced;

  // 1. Instantiate the Ollama BaseLlm subclass
  const llm = new Ollama({ model: modelName, sessionId });
  if (abortSignal) {
    llm.abortSignal = abortSignal;
  }

  // 2. Filter and wrap all current local and MCP tools based on model capabilities
  const lowerModelName = modelName ? modelName.toLowerCase() : '';
  const isImageCapable = lowerModelName.includes('gemma4') || lowerModelName.includes('gemma 4') || lowerModelName.includes('gemma-4');

  // We completely filter out the generateImage tool from all model runs to ensure no model calls generateImage directly.
  // Instead, image-capable models are forced to natively output Base64 data and call base64Convert,
  // and text-only models are forced to respond that they cannot generate images.
  let filteredTools = Object.values(tools).filter(t => t.name !== 'generateImage');
  const wrappedTools = filteredTools.map(wrapFunctionTool);

  // 3. Create the LlmAgent
  let systemPrompt = modeMeta.systemPrompt;
  const loadedSkills = getLoadedSkills();
  if (Object.keys(loadedSkills).length > 0) {
    systemPrompt += '\n\n### Available Custom Skills\n';
    systemPrompt += 'You have access to the following custom skills to help you with specialized tasks. To use a skill, call the `loadSkill` tool with the skill\'s name to read its instructions first.\n';
    for (const [name, skill] of Object.entries(loadedSkills)) {
      systemPrompt += `- **${name}**: ${skill.frontmatter.description}\n`;
    }
  }

  // Append standard guidance on image generation
  if (isImageCapable) {
    systemPrompt += `

### Image Generation Guidance
When the user asks to generate or create an image file (e.g., "generate an image of a car", "create a cat image"):
1. **NATIVE MODEL IMAGE GENERATION (REQUIRED)**: You natively support image generation (such as gemma4) and can output raw image bytes or Base64 image data directly. You MUST generate the image yourself and embed the Base64 image data directly within your response text (either as a raw Base64 word of at least 500 characters, or inside a standard markdown code block, e.g., \`\`\` <your_base64_data> \`\`\`). Do NOT call any tools (including \`base64Convert\` or \`generateImage\`) to generate or save the image. The system will automatically intercept, decode, and save your embedded Base64 image to the requested path without any tool execution.
`;
  } else {
    systemPrompt += `

### Image Generation Guidance
When the user asks to generate or create an image file (e.g., "generate an image of a car", "create a cat image"):
1. **TEXT-ONLY LIMITATION (REQUIRED)**: You are a text-only model. You cannot natively generate images or output raw/Base64 image data. Therefore, you MUST NOT attempt to call the \`generateImage\` tool or any other tool to create an image, and you must NOT output raw image data. Instead, you MUST explicitly state in your response that you cannot generate images because you are a text-only model.
`;
  }

  // Append standard guidance on background execution
  systemPrompt += `

### Background Process and Execution Guidance
When the user asks you to "execute in background", "run in background", "start the background service", "start the server", or perform a task in the background:
1. **YOU CAN RUN BACKGROUND COMMANDS**: You have the full ability to run shell commands, applications, and services in the background using the \`executeCommand\` tool. To do so, invoke \`executeCommand\` with standard shell background operators (for example, appending \` &\` to the shell command, or using \`nohup <command> > background.log 2>&1 &\`).
2. **DO NOT REFUSE**: Never refuse background execution requests by claiming you do not have graphical/process management access or a background execution environment. You run inside a Linux terminal workspace environment with standard process management capability via \`executeCommand\`.
`;

  const agent = new LlmAgent({
    name: modeKey,
    instruction: systemPrompt,
    generateContentConfig: {
      temperature: customTemperature !== null ? customTemperature : modeMeta.temperature,
    },
    model: llm,
    tools: wrappedTools
  });

  // 4. Create the Runner
  const artifactService = new FileArtifactService(path.join(process.cwd(), '.antigravitycli', 'sessions'));
  const runner = new Runner({
    appName: 'plumar-cli',
    agent: agent,
    sessionService: sessionService,
    artifactService: artifactService
  });

  // Ensure the session exists in sessionService before invoking runner.runAsync
  let session;
  try {
    session = await sessionService.getSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId: sessionId
    });
  } catch (e) {
    // ignore
  }

  if (!session) {
    await sessionService.createSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId: sessionId
    });
  }

  if (abortSignal && abortSignal.aborted) {
    throw new Error('Request cancelled by user (ESC)');
  }

  let finalResponseText = '';
  const steps = [];

  try {
    // 5. Run the conversational turn, collecting thought and content events
    for await (const event of runner.runAsync({
      userId: 'default-user',
      sessionId: sessionId,
      newMessage: { role: 'user', parts: [{ text: userMessage }] }
    })) {
      if (abortSignal && abortSignal.aborted) {
        throw new Error('Request cancelled by user (ESC)');
      }
      if (event.content && Array.isArray(event.content.parts)) {
        const thoughtParts = [];
        let textVal = '';
        
        for (const part of event.content.parts) {
          if (part.thought) {
            thoughtParts.push(part);
          } else if (part.text) {
            textVal += part.text;
          }
        }
        
        if (thoughtParts.length > 0) {
          steps.push({
            type: 'thought',
            content: {
              parts: thoughtParts
            }
          });
        }
        
        if (textVal) {
          finalResponseText += textVal;
        }
      }
    }
  } catch (err) {
    if (abortSignal && abortSignal.aborted || err.name === 'AbortError') {
      throw new Error('Request cancelled by user (ESC)');
    }
    throw err;
  }

  return {
    text: finalResponseText,
    steps: steps
  };
}
