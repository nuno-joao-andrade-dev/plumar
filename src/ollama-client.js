import { BaseLlm, FileArtifactService } from '@google/adk';
import path from 'node:path';
import fs from 'node:fs';
import { 
  getOllamaBaseUrl, 
  getOllamaHeaders, 
  getModelContextLength,
  getModelDetails,
  isVerboseJsonEnabled
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
  if (!process.stdout.isTTY) {
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

// Custom BaseLlm implementation for local/remote Ollama instance
export class Ollama extends BaseLlm {
  constructor({ model, sessionId, options }) {
    super({ model });
    this[Symbol.for('google.adk.baseModel')] = true;
    this.sessionId = sessionId;
    this.options = options || {};
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
    
    const payloadOptions = {
      num_ctx: modelContextLength,
      num_predict: -1,
      ...this.options
    };

    const payload = {
      model: this.model,
      messages: ollamaMessages,
      tools: ollamaTools,
      stream: false,
      temperature: payloadOptions.temperature ?? llmRequest.config?.temperature ?? 0.7,
      options: payloadOptions
    };
    
    const specLoader = startSpinner(`⏳ Inspecting specs for '${this.model}'...`);

    // Inspect model specifications proactively to check architecture and family
    const modelDetails = await getModelDetails(this.model);

    specLoader.stop();

    const familySpec = (modelDetails?.details?.family || '').toLowerCase();
    const familiesSpec = (modelDetails?.details?.families || []).map(f => String(f).toLowerCase());
    const architectureSpec = (modelDetails?.model_info?.['general.architecture'] || '').toLowerCase();

    const isGemma2Spec = familySpec === 'gemma2' || familiesSpec.includes('gemma2') || architectureSpec === 'gemma2';

    if (isGemma2Spec && payload.tools) {
      if (isVerboseJsonEnabled()) {
        console.log(`[Ollama ADK] Proactively stripping tools from '${this.model}' based on model specs (family/architecture: gemma2) to prevent freeze/hang.`);
      }
      delete payload.tools;
    }

    if (isVerboseJsonEnabled()) {
      console.log('Ollama Request Payload:', JSON.stringify(payload, null, 2));
    }

    let response;
    let data;
    let fallbackTextMode = false;

    const chatLoader = startSpinner(`⚡ Awaiting Ollama response ('${this.model}')...`);

    try {
      try {
        response = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: getOllamaHeaders(),
          body: JSON.stringify(payload),
          signal: activeSignal
        });
      } finally {
        chatLoader.stop();
      }
      
      if (!response.ok) {
        const errText = await response.text();
        const isToolErr = errText.toLowerCase().includes('support tool') || 
                          errText.toLowerCase().includes('support tools') || 
                          errText.toLowerCase().includes('not support') || 
                          errText.toLowerCase().includes('unsupported field: tools');
        if (isToolErr) {
          fallbackTextMode = true;
        } else {
          if (errText.includes('mllama') || errText.includes('unknown model architecture')) {
            throw new Error(`Ollama API error: ${response.status} ${response.statusText} - ${errText}\n\n💡 This error occurs because your local Ollama server is outdated and does not support the 'mllama' vision architecture required by '${this.model}'. Please update Ollama to v0.4.0 or newer to use llama3.2-vision, or switch to a supported text model using the '/model' command (e.g. '/model qwen2.5:latest' or '/model llama3:latest').`);
          }
          throw new Error(`Ollama API error: ${response.status} ${response.statusText} - ${errText}`);
        }
      } else {
        data = await response.json();
        if (data && data.error) {
          const isToolErr = typeof data.error === 'string' && (
                            data.error.toLowerCase().includes('support tool') || 
                            data.error.toLowerCase().includes('support tools') || 
                            data.error.toLowerCase().includes('not support') || 
                            data.error.toLowerCase().includes('unsupported field: tools')
                          );
          if (isToolErr) {
            fallbackTextMode = true;
          } else {
            const errStr = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
            if (errStr.includes('mllama') || errStr.includes('unknown model architecture')) {
              throw new Error(`Ollama error: ${errStr}\n\n💡 This error occurs because your local Ollama server is outdated and does not support the 'mllama' vision architecture required by '${this.model}'. Please update Ollama to v0.4.0 or newer to use llama3.2-vision, or switch to a supported text model using the '/model' command (e.g. '/model qwen2.5:latest' or '/model llama3:latest').`);
            }
            throw new Error(`Ollama error: ${data.error}`);
          }
        }
      }
    } catch (err) {
      const isToolErr = err.message && (
                        err.message.toLowerCase().includes('support tool') || 
                        err.message.toLowerCase().includes('support tools') || 
                        err.message.toLowerCase().includes('not support') || 
                        err.message.toLowerCase().includes('unsupported field: tools')
                      );
      if (isToolErr) {
        fallbackTextMode = true;
      } else {
        throw err;
      }
    }

    if (fallbackTextMode) {
      console.log(`\n\x1b[2m[Ollama ADK] Model '${this.model}' does not support tool-calling. Retrying in text-only mode...\x1b[0m`);
      
      // Strip tools from payload
      delete payload.tools;
      
      if (isVerboseJsonEnabled()) {
        console.log('Ollama Retry Request Payload (no tools):', JSON.stringify(payload, null, 2));
      }

      const retryLoader = startSpinner(`⚡ Retrying in text-only mode ('${this.model}')...`);

      try {
        response = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: getOllamaHeaders(),
          body: JSON.stringify(payload),
          signal: activeSignal
        });
      } finally {
        retryLoader.stop();
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Ollama API error (retry): ${response.status} ${response.statusText} - ${errText}`);
      }

      data = await response.json();
      if (data && data.error) {
        throw new Error(`Ollama error (retry): ${data.error}`);
      }
    }

    if (isVerboseJsonEnabled()) {
      console.log('Ollama Response Payload:', JSON.stringify(data, null, 2));
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

/**
 * Fetch available models from the local Ollama instance
 * @param {boolean} [detailed=false] If true, returns full model metadata objects. If false, returns model name strings.
 * @returns {Promise<Array<string|object>>} List of model names or model objects
 */
export async function fetchOllamaModels(detailed = false) {
  const modelsLoader = startSpinner('⏳ Fetching installed models from Ollama...');
  try {
    const baseUrl = getOllamaBaseUrl();
    let response;
    try {
      response = await fetch(`${baseUrl}/api/tags`, {
        headers: getOllamaHeaders(),
        signal: AbortSignal.timeout(5000)
      });
    } finally {
      modelsLoader.stop();
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    if (!data.models || data.models.length === 0) {
      return [];
    }
    if (detailed) {
      return data.models;
    }
    return data.models.map(m => m.name);
  } catch (error) {
    throw new Error(`Ollama API at ${getOllamaBaseUrl()} is unreachable or non-responsive. Please make sure Ollama is running and accessible.`);
  }
}
