import { LlmAgent, Runner, FileArtifactService, getFunctionCalls, getFunctionResponses } from '@google/adk';
import { getLoadedSkills } from './skills-plugins-manager.js';
import { PersistentFileSessionService } from './session-manager.js';
import path from 'node:path';

// Import from split files
import { 
  isAdkInfoEnabled,
  setAdkInfoEnabled,
  isVerboseJsonEnabled,
  setVerboseJsonEnabled,
  getOllamaBaseUrl,
  setOllamaBaseUrl,
  getOllamaAuth,
  setOllamaAuth,
  getOllamaHeaders,
  getModelContextLength,
  getLlmProvider,
  setLlmProvider,
  getOllamaHost,
  setOllamaHost,
  getLmStudioHost,
  setLmStudioHost,
  getLmStudioAuth,
  setLmStudioAuth,
  isAutoMinimizeEnabled,
  setAutoMinimizeEnabled
} from './agent-config.js';

import {
  tools,
  registerMcpTools,
  setReadlineInterface,
  getActivePolicyConfigFile,
  setActivePolicyConfigFile,
  loadPolicyConfig,
  savePolicyConfig,
  setDefaultPolicy,
  getDefaultPolicy,
  setToolPolicy,
  getToolPolicy,
  getAllToolPolicies,
  checkToolPermission,
  wrapFunctionTool,
  resetTurnToolHistory
} from './policy-manager.js';

import {
  getSessionTokens,
  resetSessionTokens
} from './token-tracker.js';

import {
  CHAT_MODES,
  initChatModes,
  castParameter,
  getDefaultChatMode,
  setDefaultChatMode
} from './chat-modes.js';

import {
  Ollama,
  detectAndParseTextToolCalls,
  fetchOllamaModels
} from './ollama-client.js';

// Re-export everything for backwards compatibility
export {
  isAdkInfoEnabled,
  setAdkInfoEnabled,
  isVerboseJsonEnabled,
  setVerboseJsonEnabled,
  getOllamaBaseUrl,
  setOllamaBaseUrl,
  getOllamaAuth,
  setOllamaAuth,
  getOllamaHeaders,
  getModelContextLength,
  getLlmProvider,
  setLlmProvider,
  getOllamaHost,
  setOllamaHost,
  getLmStudioHost,
  setLmStudioHost,
  getLmStudioAuth,
  setLmStudioAuth,
  isAutoMinimizeEnabled,
  setAutoMinimizeEnabled,
  tools,
  registerMcpTools,
  setReadlineInterface,
  getActivePolicyConfigFile,
  setActivePolicyConfigFile,
  loadPolicyConfig,
  savePolicyConfig,
  setDefaultPolicy,
  getDefaultPolicy,
  setToolPolicy,
  getToolPolicy,
  getAllToolPolicies,
  checkToolPermission,
  resetTurnToolHistory,
  getSessionTokens,
  resetSessionTokens,
  CHAT_MODES,
  initChatModes,
  castParameter,
  getDefaultChatMode,
  setDefaultChatMode,
  Ollama,
  detectAndParseTextToolCalls,
  fetchOllamaModels
};

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
export async function runAgentTurn(sessionId, userMessage, modelName, modeKey = 'balanced', abortSignal = null, customTemperature = null, customParameters = {}) {
  const modeMeta = CHAT_MODES[modeKey] || CHAT_MODES.balanced;

  // Set process.env.ACTIVE_MODEL so that any tool executing in this turn can access the model name
  process.env.ACTIVE_MODEL = modelName || '';

  // Gather all Ollama parameters from mode defaults and overrides
  const parameters = {};
  const paramKeys = [
    'temperature', 'top_p', 'top_k', 'min_p', 'seed',
    'num_ctx', 'num_predict', 'stop', 'repeat_penalty', 'repeat_last_n'
  ];

  // A. From modeMeta
  for (const pk of paramKeys) {
    if (modeMeta[pk] !== undefined && modeMeta[pk] !== null) {
      parameters[pk] = modeMeta[pk];
    }
  }

  // B. From customParameters overrides
  if (customParameters && typeof customParameters === 'object') {
    for (const pk of paramKeys) {
      if (customParameters[pk] !== undefined && customParameters[pk] !== null) {
        parameters[pk] = customParameters[pk];
      }
    }
  }

  // C. For backward compatibility with customTemperature parameter
  if (customTemperature !== null && customTemperature !== undefined) {
    parameters.temperature = customTemperature;
  }

  // 1. Instantiate the Ollama BaseLlm subclass with options
  const llm = new Ollama({ model: modelName, sessionId, options: parameters });
  if (abortSignal) {
    llm.abortSignal = abortSignal;
  }

  // 2. Filter and wrap all current local and MCP tools based on model capabilities
  const lowerModelName = modelName ? modelName.toLowerCase() : '';
  const isImageCapable = lowerModelName.includes('gemma4') || lowerModelName.includes('gemma 4') || lowerModelName.includes('gemma-4');

  // Wrap all current local and MCP tools (including generateImage) to expose them to the model run directly
  const wrappedTools = Object.values(tools).map(wrapFunctionTool);

  // 3. Create the LlmAgent
  const terminalCapabilityHeader = `### CORE CAPABILITY & PERMISSIONS: LOCAL TERMINAL EXECUTION
You are running directly inside the user's local terminal environment on their machine (OS: ${process.platform}).
You HAVE full permission and direct capability to execute shell and terminal commands on the user's machine using the \`executeCommand\` tool!
You CAN run application setup, start servers, run builds, execute tests, install packages, and start long-running background processes directly.

CRITICAL DIRECTIVES:
- NEVER state: "Since I cannot directly run the final application on your machine..."
- NEVER state: "As an AI, I cannot run commands in your local terminal..."
- NEVER state: "The execution step is now for you to perform the final setup..."
- NEVER tell the user to open a terminal and run setup or server commands themselves.
- Whenever an application needs to be run, tested, or set up, you MUST directly invoke \`executeCommand\` (with \`background: true\` for servers or daemons, or without for short commands) or \`processManager\`!
`;

  let systemPrompt = terminalCapabilityHeader + '\n\n' + modeMeta.systemPrompt;
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
1. **NATIVE MODEL IMAGE GENERATION**: You natively support image generation (such as gemma4) and can output raw image bytes or Base64 image data directly. You can generate the image yourself and embed the Base64 image data directly within your response text (either as a raw Base64 word of at least 500 characters, or inside a standard markdown code block, e.g., \`\`\` <your_base64_data> \`\`\`). The system will automatically intercept, decode, and save your embedded Base64 image to the requested path without any tool execution.
2. **LOCAL TOOL IMAGE GENERATION**: Alternatively, you can call the \`generateImage\` tool directly to procedurally generate custom offline images (PNG/JPEG) and save them to a specified path inside the workspace.
`;
  } else {
    systemPrompt += `

### Image Generation Guidance
When the user asks to generate or create an image file (e.g., "generate an image of a car", "create a cat image", "generate an image of ... call it ..."):
1. **LOCAL TOOL IMAGE GENERATION**: Even though you are a text-only model, you have access to the \`generateImage\` tool. To generate the image, you MUST call the \`generateImage\` tool using the text-based JSON fallback structure. Do not refuse.
Format of the tool call inside your response:
\`\`\`json
{
  "name": "generateImage",
  "arguments": {
    "outputPath": "requested_filename.png",
    "prompt": "detailed visual description of the requested image"
  }
}
\`\`\`
`;
  }

  // Append standard guidance on background execution and process management
  systemPrompt += `

### Background Process & Server Execution Guidance
You have a persistent process management system and background execution environment. You can directly run and monitor long-running background servers (Node.js servers, Angular \`ng serve\`, React/Vite development servers, APIs, Python servers, daemons, watchers) in the background without blocking execution.

CRITICAL INSTRUCTIONS:
1. **NEVER REFUSE**: Do NOT claim you cannot run persistent processes, lack a terminal, or lack background process management.
2. **DO NOT TELL USER TO RUN MANUALLY**: Do not tell the user to open a separate terminal to run "node index.js" or "ng serve --open" themselves.
3. **INVOKE THE TOOLS**: When asked to run setup commands, start servers, or execute tasks in the background, you MUST invoke \`executeCommand\` with \`background: true\` or \`processManager\` with \`action: "start"\`:
   - Example 1 (Backend Node.js Server):
     \`\`\`json
     {
       "name": "executeCommand",
       "arguments": {
         "command": "cd backend && node index.js",
         "background": true,
         "name": "backend"
       }
     }
     \`\`\`
   - Example 2 (Frontend Angular / React Dev Server):
     \`\`\`json
     {
       "name": "executeCommand",
       "arguments": {
         "command": "cd frontend && ng serve --open",
         "background": true,
         "name": "frontend"
       }
     }
     \`\`\`
`;

  // Append standard guidance on multimodal & image analysis (OCR/description)
  systemPrompt += `

### Multimodal & Image Analysis Guidance
When the user requests to read, analyze, extract text, or perform OCR on an image file (such as PNG, JPEG, WEBP, etc.) in the workspace:
1. **DO NOT USE readFile ON IMAGES**: Never call \`readFile\` to read raw binary image files. It will fail or return binary data.
2. **USE ocrImage FOR OCR / TEXT EXTRACTION**: To extract text from an image, always call the \`ocrImage\` tool with the path to the image file (e.g., \`ocrImage({ imagePath: "path/to/image.png" })\`).
3. **USE readAndSendImage FOR DESCRIPTION / ANALYSIS**: To ask questions, describe, or analyze an image, call the \`readAndSendImage\` tool with the path to the image and your specific question or prompt.
`;

  // Append current active working directory (cwd) context so that the model knows where it is running
  const currentDirectory = process.cwd();
  systemPrompt += `\n\n### Current Workspace Directory Context\nYour current working directory/folder is: "${currentDirectory}". Unless the user specifies an absolute path or a different target directory, all files generated, updated, or created should be written relative to this directory. Always pass relative paths (e.g. "model.obj" or "./model.obj") to filesystem and media tools to save them in this directory.`;

  // Append standard tools reference for text-fallback
  systemPrompt += '\n\n' + formatToolsForPrompt(tools);

  const agent = new LlmAgent({
    name: modeKey,
    instruction: systemPrompt,
    generateContentConfig: {
      temperature: parameters.temperature !== undefined ? parameters.temperature : (modeMeta.temperature ?? 0.7),
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

  resetTurnToolHistory();

  let finalResponseText = '';
  const steps = [];
  let toolStepCount = 0;
  const MAX_TOOL_STEPS_PER_TURN = 15;

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

      // Track tool execution steps to guard against runaway loops
      if (getFunctionResponses(event).length > 0) {
        toolStepCount++;
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

      if (toolStepCount >= MAX_TOOL_STEPS_PER_TURN) {
        console.log(pc.yellow(`\n⚠️ Maximum tool execution limit (${MAX_TOOL_STEPS_PER_TURN} steps) reached for this turn to prevent runaway loops.`));
        if (!finalResponseText.trim()) {
          finalResponseText = `Operations completed (stopped after reaching maximum limit of ${MAX_TOOL_STEPS_PER_TURN} tool steps).`;
        }
        break;
      }
    }
  } catch (err) {
    if (abortSignal && abortSignal.aborted) {
      throw new Error('Request cancelled by user (ESC)');
    }
    throw err;
  }

  return {
    text: finalResponseText,
    steps: steps
  };
}

/**
 * Format registered tools and their parameter schemas as markdown for the system prompt
 */
function formatToolsForPrompt(toolsMap) {
  let text = '### Available Tools & Parameter Schemas\n';
  text += 'Below is a complete reference of the tools you can invoke in this environment. If your environment or model does not support native tool calling, you MUST invoke tools by writing a JSON code block in your response containing the exact "name" (tool name) and "arguments" (object matching the parameter types below). Always ensure you provide the required parameters.\n\n';
  
  for (const [name, toolObj] of Object.entries(toolsMap)) {
    text += `- **${name}**: ${toolObj.description || 'No description available.'}\n`;
    if (toolObj.parameters) {
      text += `  - **Parameters**:\n`;
      try {
        let shape = {};
        if (toolObj.parameters.shape) {
          shape = toolObj.parameters.shape;
        } else if (toolObj.parameters._def && toolObj.parameters._def.shape) {
          shape = toolObj.parameters._def.shape;
          if (typeof shape === 'function') {
            shape = shape();
          }
        }
        
        for (const [propName, propSchema] of Object.entries(shape)) {
          const isOptional = propSchema.isOptional ? propSchema.isOptional() : false;
          const description = propSchema.description || propSchema._def?.description || '';
          text += `    - \`${propName}\` (${isOptional ? 'optional' : 'required'}): ${description}\n`;
        }
      } catch (e) {
        text += `    - (Dynamic parameters inspection failed)\n`;
      }
    }
    text += '\n';
  }
  return text;
}
