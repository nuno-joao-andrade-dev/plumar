#!/usr/bin/env node
import './src/formatter.js';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import pc from 'picocolors';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'node:fs';
import path from 'node:path';

const execPromise = promisify(exec);

/**
 * Parses user input to extract dynamic shell command execution via prompt piping (e.g. prompt | shell command)
 */
export function parsePromptPiping(userInput) {
  const pipeIndex = userInput.indexOf('|');
  if (pipeIndex === -1) return { prompt: userInput, command: null };
  
  const promptPart = userInput.slice(0, pipeIndex).trim();
  const commandPart = userInput.slice(pipeIndex + 1).trim();
  
  // Safety checks to distinguish between typical questions and actual pipes
  if (!commandPart || commandPart.length < 1) {
    return { prompt: userInput, command: null };
  }
  
  // If the user starts the input with a pipe operator, it is a direct shell command bypass.
  // We do not apply any natural sentence or question heuristics.
  if (promptPart === '') {
    return { prompt: '', command: commandPart };
  }
  
  // If the command part ends with '?', it's highly likely a question (e.g., "what is |?")
  if (commandPart.endsWith('?')) {
    return { prompt: userInput, command: null };
  }
  
  // If the command part contains no alphanumeric characters at all, it's not a real command
  if (!/[a-zA-Z0-9]/.test(commandPart)) {
    return { prompt: userInput, command: null };
  }

  // If the command part looks like a natural sentence instead of a command, exclude it
  const words = commandPart.split(/\s+/);
  if (words.length > 2) {
    const hasShellIndicator = commandPart.includes('-') || 
                               commandPart.includes('/') || 
                               commandPart.includes('\\') || 
                               commandPart.includes('.') || 
                               commandPart.includes('>') || 
                               commandPart.includes('<') || 
                               commandPart.includes('$') || 
                               commandPart.includes('|');
    if (!hasShellIndicator) {
      return { prompt: userInput, command: null };
    }
  }
  
  return { prompt: promptPart, command: commandPart };
}

/**
 * Safely executes a shell command inside the active workspace directory with a timeout
 */
export async function executePipeCommand(command, abortSignal) {
  try {
    const { stdout, stderr } = await execPromise(command, { timeout: 30000, signal: abortSignal });
    return (stdout || '') + (stderr || '');
  } catch (err) {
    if (err.name === 'AbortError' || (abortSignal && abortSignal.aborted)) {
      throw err;
    }
    return `Error executing command "${command}": ${err.message}\n${err.stderr || ''}`;
  }
}

import { runAgentTurn, tools, fetchOllamaModels, CHAT_MODES, getOllamaBaseUrl, setOllamaBaseUrl, getOllamaAuth, setOllamaAuth, registerMcpTools, sessionService, isVerboseJsonEnabled, setVerboseJsonEnabled, isAdkInfoEnabled, setAdkInfoEnabled, setReadlineInterface, setDefaultPolicy, setToolPolicy, getToolPolicy, getAllToolPolicies, getDefaultPolicy, getActivePolicyConfigFile, loadPolicyConfig, savePolicyConfig, getSessionTokens, castParameter, getLlmProvider, setLlmProvider, getOllamaHost, setOllamaHost, getLmStudioHost, setLmStudioHost, getLmStudioAuth, setLmStudioAuth } from './src/agent.js';
import { loadAndStartMcpServers, getMcpTools } from './src/mcp-client-manager.js';
import { 
  printBanner, 
  printHelp, 
  printFeatures,
  printTools, 
  printThinkingProcess, 
  printStatus, 
  printModes, 
  printModelSelection,
  printSkills,
  printPlugins,
  printSamples,
  formatChatResponse,
  initializeFormatter
} from './src/formatter.js';

/**
 * Loads session events and populates them into the readline history in reverse chronological order
 * so that Up/Down arrows and Ctrl+R can be used with previous prompts.
 */
export async function populateReadlineHistory(rl, sessionId, service = sessionService) {
  if (!rl || !service) return;
  try {
    const fullSession = await service.getSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId: sessionId
    });

    if (fullSession && fullSession.events) {
      const prompts = [];
      for (const event of fullSession.events) {
        // Robust check for user events (handles real ADK events & simplified test mocks)
        const isUser = event.role === 'user' || 
                       event.author === 'user' || 
                       (event.content && event.content.role === 'user');

        if (isUser) {
          let text = '';
          
          if (event.content && Array.isArray(event.content.parts)) {
            for (const part of event.content.parts) {
              if (part.text) {
                text += part.text;
              }
            }
          } else if (Array.isArray(event.parts)) {
            for (const part of event.parts) {
              if (part.text) {
                text += part.text;
              }
            }
          } else if (event.content && typeof event.content === 'string') {
            text = event.content;
          } else if (event.text && typeof event.text === 'string') {
            text = event.text;
          }

          const trimmed = text.trim();
          // Filter readable, clean user prompts under 250 characters and not starting with / or containing newlines
          if (trimmed && trimmed.length < 250 && !trimmed.startsWith('/') && !trimmed.includes('\n')) {
            prompts.push(trimmed);
          }
        }
      }

      if (!rl.history) {
        rl.history = [];
      }
      rl.history.length = 0;
      const uniquePrompts = [];
      const seen = new Set();
      for (let i = prompts.length - 1; i >= 0; i--) {
        const p = prompts[i];
        if (!seen.has(p)) {
          seen.add(p);
          uniquePrompts.push(p);
        }
      }
      rl.history.push(...uniquePrompts);
      rl.historyIndex = -1;
    }
  } catch (err) {
    // ignore
  }
}

/**
 * Prints a list of key-value settings in a premium aligned box-drawing ASCII/ANSI table format.
 */
export function printSettingsTable(title, settings) {
  let maxLabelWidth = 0;
  let maxValueWidth = 0;
  
  for (const item of settings) {
    const labelLen = String(item.label).length;
    const valueLen = String(item.value).length;
    if (labelLen > maxLabelWidth) maxLabelWidth = labelLen;
    if (valueLen > maxValueWidth) maxValueWidth = valueLen;
  }
  
  if (maxLabelWidth < 15) maxLabelWidth = 15;
  if (maxValueWidth < 15) maxValueWidth = 15;
  
  const topBorder = pc.bold(pc.cyan('┌' + '─'.repeat(maxLabelWidth + 2) + '┬' + '─'.repeat(maxValueWidth + 2) + '┐'));
  const bottomBorder = pc.bold(pc.cyan('└' + '─'.repeat(maxLabelWidth + 2) + '┴' + '─'.repeat(maxValueWidth + 2) + '┘'));
  
  console.log(pc.yellow(`\n⚙️  ${title}:`));
  console.log(topBorder);
  
  for (const item of settings) {
    const paddedLabel = String(item.label).padEnd(maxLabelWidth);
    const paddedValue = String(item.value).padEnd(maxValueWidth);
    const coloredLabel = pc.bold(paddedLabel);
    const coloredValue = pc.magenta(paddedValue);
    console.log(pc.bold(pc.cyan('│ ')) + coloredLabel + pc.bold(pc.cyan(' │ ')) + coloredValue + pc.bold(pc.cyan(' │')));
  }
  console.log(bottomBorder + '\n');
}

/**
 * Displays the current CLI settings using the printSettingsTable helper.
 */
export function displaySettingsTable() {
  const activeFile = getActivePolicyConfigFile();
  const provider = getLlmProvider();
  const providerName = provider === 'lmstudio' ? 'LM Studio' : 'Ollama';
  const settingsData = [
    { label: 'LLM Provider', value: providerName },
    { label: `${providerName} Endpoint`, value: getOllamaBaseUrl() },
    { label: `${providerName} Auth`, value: getOllamaAuth() ? '****** (Configured)' : 'None' },
    { label: 'Verbose JSON Logs', value: isVerboseJsonEnabled() ? 'ON' : 'OFF' },
    { label: 'ADK Info Logs', value: isAdkInfoEnabled() ? 'ON' : 'OFF' },
    { label: 'Default Tool Policy', value: getDefaultPolicy().toUpperCase() },
    { label: 'Active Config File', value: activeFile ? activeFile : 'None' }
  ];
  printSettingsTable('Current CLI Settings', settingsData);
}


async function runModelSelectionFlow(rl, isStartup = false, currentActiveModel = '') {
  let selectedModel = null;
  rl.line = '';
  rl.cursor = 0;
  while (!selectedModel) {
    console.log(pc.dim(`Querying Ollama at ${pc.bold(getOllamaHost())} and LM Studio at ${pc.bold(getLmStudioHost())} for models...\n`));

    let ollamaModels = [];
    let lmStudioModels = [];
    let ollamaError = null;
    let lmStudioError = null;

    const ollamaPromise = (async () => {
      const oldProvider = getLlmProvider();
      try {
        setLlmProvider('ollama');
        ollamaModels = await fetchOllamaModels(true);
      } catch (err) {
        ollamaError = err.message;
      } finally {
        setLlmProvider(oldProvider);
      }
    })();

    const lmStudioPromise = (async () => {
      const oldProvider = getLlmProvider();
      try {
        setLlmProvider('lmstudio');
        lmStudioModels = await fetchOllamaModels(true);
      } catch (err) {
        lmStudioError = err.message;
      } finally {
        setLlmProvider(oldProvider);
      }
    })();

    await Promise.all([ollamaPromise, lmStudioPromise]);

    console.log(pc.bold(pc.yellow('\n🤖 Available Models:')));
    console.log(pc.bold(pc.cyan('─'.repeat(60))));

    let listIndex = 1;
    const modelLookup = []; // Maps listIndex to selection item

    if (ollamaModels.length > 0) {
      console.log(pc.bold(pc.magenta(' Ollama:')));
      ollamaModels.forEach(m => {
        const isSelected = m.name === currentActiveModel && getLlmProvider() === 'ollama';
        const bullet = isSelected ? pc.bold(pc.green('❯')) : ' ';
        const num = pc.cyan(` [${listIndex}]`);
        const name = isSelected ? pc.bold(pc.green(m.name)) : m.name;
        
        let extraInfo = '';
        const charParts = [];
        if (m.details?.family) charParts.push(m.details.family);
        if (m.details?.parameter_size) charParts.push(m.details.parameter_size);
        if (m.size) {
          const gb = m.size / (1024 * 1024 * 1024);
          charParts.push(`${gb.toFixed(1)} GB`);
        }
        if (charParts.length > 0) {
          extraInfo = pc.dim(` (${charParts.join(', ')})`);
        }

        console.log(`  ${bullet} ${num} ${name}${extraInfo}`);
        modelLookup.push({ name: m.name, provider: 'ollama' });
        listIndex++;
      });
    } else {
      console.log(pc.bold(pc.magenta(' Ollama:')) + pc.dim(' (No models found or server offline)'));
    }

    console.log();

    if (lmStudioModels.length > 0) {
      console.log(pc.bold(pc.magenta(' LM Studio:')));
      lmStudioModels.forEach(m => {
        const isSelected = m.name === currentActiveModel && getLlmProvider() === 'lmstudio';
        const bullet = isSelected ? pc.bold(pc.green('❯')) : ' ';
        const num = pc.cyan(` [${listIndex}]`);
        const name = isSelected ? pc.bold(pc.green(m.name)) : m.name;
        
        console.log(`  ${bullet} ${num} ${name}`);
        modelLookup.push({ name: m.name, provider: 'lmstudio' });
        listIndex++;
      });
    } else {
      console.log(pc.bold(pc.magenta(' LM Studio:')) + pc.dim(' (No models found or server offline)'));
    }

    console.log(pc.bold(pc.cyan('─'.repeat(60))));
    console.log(pc.bold(pc.yellow(' Additional Options:')));
    console.log(`  ${pc.cyan(' [C]')} ${pc.bold('Configure')} Endpoints & Authentication`);
    console.log(`  ${pc.cyan(' [M]')} ${pc.bold('Manual')} model name override`);
    const exitLabel = isStartup ? 'Exit Plumar' : 'Go back without changing model';
    console.log(`  ${pc.cyan(' [E]')} ${pc.bold(exitLabel)}\n`);

    rl.line = '';
    rl.cursor = 0;
    const answer = await rl.question(pc.green(pc.bold('Choose model number or option letter (C/M/E) › ')));
    const trimmed = answer.trim().toLowerCase();

    if (trimmed === 'c') {
      let back = false;
      while (!back) {
        console.clear();
        console.log(pc.bold(pc.yellow('\n⚙️  Configure Endpoints & Authentication:')));
        console.log(pc.bold(pc.cyan('─'.repeat(60))));
        console.log(`  ${pc.cyan('[1]')} Configure Ollama Endpoint (current: ${pc.bold(getOllamaHost())})`);
        console.log(`  ${pc.cyan('[2]')} Configure Ollama Authentication Header/Token (current: ${pc.bold(getOllamaAuth() ? '******' : 'None')})`);
        console.log(`  ${pc.cyan('[3]')} Configure LM Studio Endpoint (current: ${pc.bold(getLmStudioHost())})`);
        console.log(`  ${pc.cyan('[4]')} Configure LM Studio Authentication Header/Token (current: ${pc.bold(getLmStudioAuth() ? '******' : 'None')})`);
        console.log(`  ${pc.cyan('[5]')} Save & Go Back`);
        console.log(pc.bold(pc.cyan('─'.repeat(60))));

        const configChoice = await rl.question(pc.green(pc.bold('Choose option (1-5) › ')));
        const trimmedChoice = configChoice.trim();

        if (trimmedChoice === '1') {
          const newUrl = await rl.question(pc.cyan(`Enter Ollama Server URL (press [Enter] to keep current: ${getOllamaHost()}) › `));
          if (newUrl.trim()) {
            setOllamaHost(newUrl.trim());
            console.log(pc.green(`✔ Ollama Host successfully updated to: ${pc.bold(getOllamaHost())}`));
            await new Promise(r => setTimeout(r, 800));
          }
        } else if (trimmedChoice === '2') {
          const newAuth = await rl.question(pc.cyan(`Enter Ollama Authentication Header/Token (type "none" to clear) › `));
          const tAuth = newAuth.trim();
          if (tAuth) {
            if (tAuth.toLowerCase() === 'none' || tAuth.toLowerCase() === 'clear') {
              setOllamaAuth('');
            } else {
              setOllamaAuth(tAuth);
            }
            console.log(pc.green(`✔ Ollama Authentication successfully updated.`));
            await new Promise(r => setTimeout(r, 800));
          }
        } else if (trimmedChoice === '3') {
          const newUrl = await rl.question(pc.cyan(`Enter LM Studio Server URL (press [Enter] to keep current: ${getLmStudioHost()}) › `));
          if (newUrl.trim()) {
            setLmStudioHost(newUrl.trim());
            console.log(pc.green(`✔ LM Studio Host successfully updated to: ${pc.bold(getLmStudioHost())}`));
            await new Promise(r => setTimeout(r, 800));
          }
        } else if (trimmedChoice === '4') {
          const newAuth = await rl.question(pc.cyan(`Enter LM Studio Authentication Header/Token (type "none" to clear) › `));
          const tAuth = newAuth.trim();
          if (tAuth) {
            if (tAuth.toLowerCase() === 'none' || tAuth.toLowerCase() === 'clear') {
              setLmStudioAuth('');
            } else {
              setLmStudioAuth(tAuth);
            }
            console.log(pc.green(`✔ LM Studio Authentication successfully updated.`));
            await new Promise(r => setTimeout(r, 800));
          }
        } else if (trimmedChoice === '5') {
          back = true;
        }
      }
      console.clear();
      console.log(pc.cyan('🔄 Refreshing models list...\n'));
    } else if (trimmed === 'm') {
      const manualName = await rl.question(pc.cyan('Enter model name manually › '));
      if (manualName.trim()) {
        selectedModel = manualName.trim();
        const providerAnswer = await rl.question(pc.cyan(`Select LLM Provider for manual model (1: Ollama, 2: LM Studio, current: ${getLlmProvider() === 'lmstudio' ? 'LM Studio' : 'Ollama'}) › `));
        let chosenProvider = 'ollama';
        if (providerAnswer.trim() === '2') {
          chosenProvider = 'lmstudio';
        }
        setLlmProvider(chosenProvider);
        console.log(pc.green(`✔ Configured with manual model name: ${pc.bold(selectedModel)}\n`));
        return { selectedModel, provider: chosenProvider };
      }
    } else if (trimmed === 'e') {
      if (isStartup) {
        console.log(pc.magenta(pc.bold('\n👋 Goodbye! Thank you for using Plumar.')));
        rl.close();
        process.exit(0);
      } else {
        return null;
      }
    } else {
      const choiceIndex = parseInt(trimmed, 10) - 1;
      if (choiceIndex >= 0 && choiceIndex < modelLookup.length) {
        const selected = modelLookup[choiceIndex];
        setLlmProvider(selected.provider);
        selectedModel = selected.name;
        console.log(pc.green(`✔ Selected active provider: ${pc.bold(selected.provider === 'lmstudio' ? 'LM Studio' : 'Ollama')}`));
        console.log(pc.green(`✔ Selected active model: ${pc.bold(selectedModel)}\n`));
        await new Promise(r => setTimeout(r, 600));
        return { selectedModel, provider: selected.provider };
      } else {
        const matched = modelLookup.find(item => item.name.toLowerCase() === trimmed);
        if (matched) {
          setLlmProvider(matched.provider);
          selectedModel = matched.name;
          console.log(pc.green(`✔ Selected active provider: ${pc.bold(matched.provider === 'lmstudio' ? 'LM Studio' : 'Ollama')}`));
          console.log(pc.green(`✔ Selected active model: ${pc.bold(selectedModel)}\n`));
          await new Promise(r => setTimeout(r, 600));
          return { selectedModel, provider: matched.provider };
        } else {
          console.log(pc.red('❌ Invalid selection. Please enter a valid number or option letter.\n'));
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }
  }
  return { selectedModel, provider: getLlmProvider() };
}


async function main() {
  // Parse verbosity flags
  if (process.argv.includes('--verbose') || process.argv.includes('--verbose-json') || process.argv.includes('-v')) {
    setVerboseJsonEnabled(true);
  }

  // Parse ADK info flags
  if (process.argv.includes('--adk-info') || process.argv.includes('--enable-adk-info')) {
    setAdkInfoEnabled(true);
  }

  // Parse tool policy config file first
  let policyConfigPath = null;
  const configIndex = process.argv.findIndex(arg => arg === '--policy-config');
  if (configIndex !== -1 && configIndex + 1 < process.argv.length) {
    policyConfigPath = process.argv[configIndex + 1];
  } else {
    const configEqArg = process.argv.find(arg => arg.startsWith('--policy-config='));
    if (configEqArg) {
      policyConfigPath = configEqArg.split('=')[1];
    }
  }

  if (policyConfigPath) {
    if (fs.existsSync(policyConfigPath)) {
      loadPolicyConfig(policyConfigPath);
    } else {
      // Initialize the new config file with current defaults
      savePolicyConfig(policyConfigPath);
      console.log(pc.green(`✔ Created and initialized new policy config file: ${pc.bold(policyConfigPath)}\n`));
    }
  } else if (fs.existsSync('policy-config.json')) {
    loadPolicyConfig('policy-config.json');
  }

  // Parse Ollama endpoint config from command line arguments to allow startup override
  let commandLineHost = null;
  const hostIndex = process.argv.findIndex(arg => arg === '--host' || arg === '--ollama-host' || arg === '--endpoint' || arg === '--ollama-endpoint');
  if (hostIndex !== -1 && hostIndex + 1 < process.argv.length) {
    commandLineHost = process.argv[hostIndex + 1];
  } else {
    const hostEqArg = process.argv.find(arg => arg.startsWith('--host=') || arg.startsWith('--ollama-host=') || arg.startsWith('--endpoint=') || arg.startsWith('--ollama-endpoint='));
    if (hostEqArg) {
      commandLineHost = hostEqArg.split('=')[1];
    }
  }
  if (commandLineHost) {
    setOllamaBaseUrl(commandLineHost);
  }

  // Parse specific tool policy overrides from command-line arguments
  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--policy-config' || arg.startsWith('--policy-config=')) {
      continue;
    }
    if (arg === '--policy-default' && i + 1 < process.argv.length) {
      setDefaultPolicy(process.argv[i + 1]);
    } else if (arg.startsWith('--policy-default=')) {
      setDefaultPolicy(arg.split('=')[1]);
    } else if (arg.startsWith('--policy-')) {
      const parts = arg.slice(9).split('=');
      const toolName = parts[0];
      let policy = parts[1];
      if (!policy && i + 1 < process.argv.length && !process.argv[i + 1].startsWith('-')) {
        policy = process.argv[i + 1];
      }
      if (toolName && policy) {
        setToolPolicy(toolName, policy);
      }
    }
  }

  // Parse info/diagnostics flags on startup
  if (process.argv.includes('--info') || process.argv.includes('-i')) {
    let selectedModel = 'None';
    try {
      const models = await fetchOllamaModels();
      if (models.length > 0) {
        selectedModel = models[0];
      }
    } catch (e) {
      // ignore
    }

    const showJson = process.argv.includes('--json') || process.argv.includes('-j') || process.argv.includes('--info-json');

    if (showJson) {
      console.log(pc.yellow('\n📊 Session Diagnostics (JSON):'));
      console.log(JSON.stringify({
        activeModel: selectedModel,
        activeMode: 'balanced',
        sessionId: 'session-bootstrap',
        workspaceRoot: process.cwd(),
        llmProvider: getLlmProvider(),
        serverEndpoint: getOllamaBaseUrl(),
        verboseJsonLogs: isVerboseJsonEnabled(),
        adkInfoLogs: isAdkInfoEnabled(),
        session: null
      }, null, 2));
      console.log();
    } else {
      const provider = getLlmProvider();
      const providerName = provider === 'lmstudio' ? 'LM Studio' : 'Ollama';
      const startupInfoData = [
        { label: 'Active Model', value: selectedModel },
        { label: 'Active Chat Mode', value: 'Balanced Assistant' },
        { label: 'ADK Session ID', value: 'session-bootstrap' },
        { label: 'History Events', value: '0 events' },
        { label: 'Workspace Root', value: process.cwd() },
        { label: 'LLM Provider', value: providerName },
        { label: `${providerName} Endpoint`, value: getOllamaBaseUrl() },
        { label: 'Verbose JSON Logs', value: isVerboseJsonEnabled() ? 'ON' : 'OFF' },
        { label: 'ADK Info Logs', value: isAdkInfoEnabled() ? 'ON' : 'OFF' }
      ];
      printSettingsTable('Session Diagnostics', startupInfoData);
    }
    process.exit(0);
  }


  // 1.3. Initialize Glamour/Lipgloss formatter
  try {
    await initializeFormatter();
  } catch (err) {
    process.stderr.write(`⚠️  Failed to initialize Glamour formatter: ${err.message}\n`);
  }

  // 1.5. Initialize custom skills and plugins
  try {
    const { loadAllSkills, loadAllPlugins } = await import('./src/skills-plugins-manager.js');
    await loadAllSkills();
    const loadedPlugins = await loadAllPlugins();
    
    // Register custom plugin tools
    for (const [fileName, pluginInfo] of Object.entries(loadedPlugins)) {
      for (const tool of pluginInfo.tools) {
        tools[tool.name] = tool;
      }
    }
  } catch (err) {
    process.stderr.write(`⚠️  Failed to load custom skills/plugins: ${err.message}\n`);
  }

  // 1.6. Initialize persistent sessions
  try {
    await sessionService.init();
  } catch (err) {
    process.stderr.write(`⚠️  Failed to initialize persistent sessions: ${err.message}\n`);
  }

  if (process.argv.includes('--mcp') || process.env.MCP_MODE === 'true') {
    const { runMcpServer } = await import('./src/mcp.js');
    runMcpServer();
    return;
  }

  const rl = readline.createInterface({ input, output });

  // Wrap rl.question to clean up any terminal query response fragments from returned user input
  const originalQuestion = rl.question.bind(rl);
  rl.question = async function(query, options) {
    rl.line = '';
    rl.cursor = 0;
    let answer = await originalQuestion(query, options);
    if (typeof answer === 'string') {
      // 1. Standard patterns (fully escaped)
      answer = answer.replace(/\x1b\](?:10|11|4);[^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
      answer = answer.replace(/\u001b\](?:10|11|4);[^\x07\u001b]*(?:\x07|\u001b\\)/g, '');
      answer = answer.replace(/\x1b\[\d+(?:;\d+)*R/g, '');
      answer = answer.replace(/\u001b\[\d+(?:;\d+)*R/g, '');
      answer = answer.replace(/\x1b\[\??\d+(?:;\d+)*c/g, '');
      answer = answer.replace(/\u001b\[\??\d+(?:;\d+)*c/g, '');
      answer = answer.replace(/\x1b\[>\d+(?:;\d+)*c/g, '');
      answer = answer.replace(/\u001b\[>\d+(?:;\d+)*c/g, '');

      // 2. Fragment-resistant patterns
      answer = answer.replace(/\x1b\](?:10|11|4);?/g, '');
      answer = answer.replace(/\u001b\](?:10|11|4);?/g, '');
      // Match rgb: prefix and any hex digits/slashes first to prevent split fragments like rgb: remaining
      answer = answer.replace(/rgb:[0-9a-fA-F/]*/gi, '');
      answer = answer.replace(/\/?(?:[0-9a-fA-F]{1,4}\/)*[0-9a-fA-F]{1,4}(?:\x07|\x1b\\)/gi, '');
      answer = answer.replace(/\/?(?:[0-9a-fA-F]{1,4}\/)+[0-9a-fA-F]{1,4}/gi, '');
      answer = answer.replace(/\d+;rgb:/gi, '');
      answer = answer.replace(/\b10;\b/g, '');
      answer = answer.replace(/\b11;\b/g, '');
      answer = answer.replace(/\b\d+;\d+R\b/gi, '');
      answer = answer.replace(/\b\d+R\b/gi, '');
      answer = answer.replace(/[\x07]/g, '');
    }
    return answer;
  };

  setReadlineInterface(rl);

  // Register Ctrl+R reverse search hook
  try {
    const { registerReverseSearchHook } = await import('./src/reverse-search.js');
    registerReverseSearchHook(rl, sessionService);
  } catch (err) {
    // ignore
  }
  let sessionId = 'session-' + Date.now();
  let activeModel = '';
  let activeMode = 'balanced';
  let activeTemperature = null;
  let activeParameters = {};
  let alwaysShowOutput = null;

  const ALLOWED_PARAMETERS = [
    'temperature', 'top_p', 'top_k', 'min_p', 'seed',
    'num_ctx', 'num_predict', 'stop', 'repeat_penalty', 'repeat_last_n'
  ];

  // Graceful exit handler
  const shutdown = () => {
    try {
      const tokens = getSessionTokens();
      const tokenSettings = [
        { label: 'Input Tokens', value: `${tokens.input}` },
        { label: 'Output Tokens', value: `${tokens.output}` },
        { label: 'Total Tokens', value: `${tokens.total}` }
      ];
      printSettingsTable('Expended Token Usage', tokenSettings);
    } catch (err) {
      // ignore
    }
    console.log(pc.magenta(pc.bold('\n👋 Goodbye! Thank you for using Plumar.')));
    rl.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);

  // Clear screen before launching setup
  console.clear();
  console.log(pc.magenta(pc.bold('🤖 Starting Plumar (plumar-cli)...')));
  
  // 1. Interactive Model Selection on Startup
  const setupResult = await runModelSelectionFlow(rl, true, activeModel);
  const selectedModel = setupResult ? setupResult.selectedModel : null;

  activeModel = selectedModel;

  // Ask for custom temperature
  let tempAnswer = await rl.question(pc.cyan('Enter temperature (0.0 - 1.0, or press [Enter] for default) › '));
  tempAnswer = tempAnswer.trim();
  if (tempAnswer) {
    const parsedTemp = parseFloat(tempAnswer);
    if (!isNaN(parsedTemp) && parsedTemp >= 0 && parsedTemp <= 1.0) {
      activeTemperature = parsedTemp;
      console.log(pc.green(`✔ Model temperature configured to: ${pc.bold(activeTemperature)}\n`));
    } else {
      console.log(pc.yellow(`⚠️  Invalid temperature. Using profile default.\n`));
      activeTemperature = null;
    }
  } else {
    activeTemperature = null;
  }

  // 1.5. Ask to load the last session if it exists
  try {
    const { sessions } = await sessionService.listSessions({
      appName: 'plumar-cli',
      userId: 'default-user',
      order: 'desc'
    });
    if (sessions && sessions.length > 0) {
      const lastSession = sessions[0];
      const dateStr = lastSession.lastUpdateTime 
        ? new Date(lastSession.lastUpdateTime).toLocaleString()
        : 'unknown time';
      console.log(pc.yellow(`\n📂 Found an existing session from your last run:`));
      console.log(`  • ${pc.bold('Session ID')}:   ${pc.cyan(lastSession.id)}`);
      console.log(`  • ${pc.bold('Last Active')}:  ${pc.cyan(dateStr)}`);
      
      const answer = await rl.question(pc.green(pc.bold('\nDo you want to load and resume this last session? [Y/n] › ')));
      const answerTrimmed = answer.trim().toLowerCase();
      if (answerTrimmed === '' || answerTrimmed.startsWith('y')) {
        sessionId = lastSession.id;
        await populateReadlineHistory(rl, sessionId);
        console.log(pc.green(`✔ Loaded and resumed last session: ${pc.bold(sessionId)}\n`));
        await new Promise(r => setTimeout(r, 800));
      } else {
        console.log(pc.yellow(`✔ Starting a new clean session.\n`));
        await new Promise(r => setTimeout(r, 600));
      }
    }
  } catch (err) {
    // ignore
  }

  let mcpLoaded = false;

  // 2. Launch Main Interface
  console.clear();
  printBanner();
  printStatus(activeModel, activeMode, CHAT_MODES[activeMode], activeTemperature);

  try {
    while (true) {
      if (!mcpLoaded) {
        mcpLoaded = true;
        console.log(pc.cyan('🔌 Connecting to Model Context Protocol (MCP) servers...'));
        try {
          await loadAndStartMcpServers();
          registerMcpTools(getMcpTools());
          console.log(pc.green('✔ Connected to Model Context Protocol (MCP) servers successfully!\n'));
        } catch (err) {
          process.stderr.write(`⚠️  Failed to connect to external MCP servers: ${err.message}\n`);
        }
      }
      // Check if session size exceeds 256KB and suggest /minimize
      try {
        const session = await sessionService.getSession({
          appName: 'plumar-cli',
          userId: 'default-user',
          sessionId: sessionId
        });
        if (session && session.events) {
          const serializedSize = Buffer.byteLength(JSON.stringify(session.events), 'utf8');
          const sizeKb = serializedSize / 1024;
          if (sizeKb > 256) {
            console.log(pc.yellow(`\n💡 Tip: Your active session context is quite large (${sizeKb.toFixed(1)} KB, > 256 KB).`));
            console.log(pc.yellow(`   Consider typing ${pc.bold('/minimize')} to prune older history and reduce latency.\n`));
          }
        }
      } catch (e) {
        // ignore
      }

      // Ask user for input
      const userInput = await rl.question(pc.green(pc.bold('You › ')));
      const trimmedInput = userInput.trim();

      // Skip empty messages
      if (!trimmedInput) {
        continue;
      }

      // Handle special slash commands
      if (trimmedInput.startsWith('/')) {
        const parts = trimmedInput.split(' ');
        const command = parts[0].toLowerCase();
        const arg = parts.slice(1).join(' ').trim();
        
        if (command === '/exit' || command === '/quit') {
          shutdown();
        } 
        
        else if (command === '/clear') {
          console.clear();
          printBanner();
          printStatus(activeModel, activeMode, CHAT_MODES[activeMode], activeTemperature);
          
          sessionId = 'session-' + Date.now();
          if (rl.history) {
            rl.history.length = 0;
            rl.historyIndex = -1;
          }
          alwaysShowOutput = null;
          console.log(pc.dim('Active conversation cleared. Started a new clean session.\n'));
          continue;
        } 

        else if (command === '/sessions') {
          const { runSessionsDashboard } = await import('./src/session-manager.js');
          const result = await runSessionsDashboard(rl, sessionId, sessionService);
          
          if (result && result.action === 'load') {
            sessionId = result.sessionId;
            await populateReadlineHistory(rl, sessionId);
            alwaysShowOutput = null;
            console.clear();
            printBanner();
            printStatus(activeModel, activeMode, CHAT_MODES[activeMode], activeTemperature);
            console.log(pc.green(`✔ Successfully loaded and resumed session: ${pc.bold(sessionId)}\n`));
          } else if (result && result.action === 'deleted_active') {
            sessionId = 'session-' + Date.now();
            if (rl.history) {
              rl.history.length = 0;
              rl.historyIndex = -1;
            }
            alwaysShowOutput = null;
            console.clear();
            printBanner();
            printStatus(activeModel, activeMode, CHAT_MODES[activeMode], activeTemperature);
            console.log(pc.yellow(`✔ Active session was deleted. Started a new clean session: ${pc.bold(sessionId)}\n`));
          } else {
            console.clear();
            printBanner();
            printStatus(activeModel, activeMode, CHAT_MODES[activeMode], activeTemperature);
          }
          continue;
        } 

        else if (command === '/history') {
          const { loadSearchHistory } = await import('./src/reverse-search.js');
          const historyList = await loadSearchHistory(rl, sessionService);
          console.log(pc.yellow('\n📜 Command & Prompt History:'));
          if (historyList.length === 0) {
            console.log(pc.dim('  No history found yet.'));
          } else {
            // Print history in chronological order (from oldest to newest)
            const list = [...historyList].reverse();
            list.forEach((item, idx) => {
              console.log(`  ${pc.dim(`[${idx + 1}]`)} ${pc.cyan(item)}`);
            });
          }
          console.log();
          continue;
        }

        else if (command === '/minimize') {
          const res = await sessionService.minimizeSession('plumar-cli', 'default-user', sessionId, 10, activeModel);
          if (!res) {
            console.log(pc.yellow('\n⚠️  Active session has no history to minimize.\n'));
            continue;
          }

          if (!res.success) {
            console.log(pc.yellow(`\n⚠️  Active session is already minimized (${res.initialCount} events, ${res.initialKb} KB).\n`));
            continue;
          }

          console.log(pc.green(`\n✔ Successfully minimized session context!`));
          if (res.toolResultsStripped) {
            console.log(`  • ${pc.bold('Type')}:     ${pc.green('Tool-Result Stripping (Metadata Pruning)')}`);
            console.log(`  • ${pc.bold('History')}:  ${pc.green('All ' + res.finalCount + ' events preserved chronologically (older raw data pruned)')}`);
          } else if (res.summarized) {
            console.log(`  • ${pc.bold('Type')}:     ${pc.green('Model-based Content Compression (In-Place)')}`);
            console.log(`  • ${pc.bold('History')}:  ${pc.green('All ' + res.finalCount + ' events preserved chronologically')}`);
          } else {
            console.log(`  • ${pc.bold('Type')}:     ${pc.yellow('Structural Truncation (Fallback)')}`);
            console.log(`  • ${pc.bold('Events')}:   ${pc.red(res.initialCount)} › ${pc.green(res.finalCount)}`);
          }
          console.log(`  • ${pc.bold('Size')}:     ${pc.red(res.initialKb + ' KB')} › ${pc.green(res.finalKb + ' KB')}\n`);
          continue;
        }

        else if (command === '/context') {
          const ignoreDirs = ['node_modules', '.git', '.antigravitycli', '.gemini', 'package-lock.json', '.DS_Store'];

          let targetDir = process.cwd();
          if (arg) {
            targetDir = path.resolve(process.cwd(), arg);
            try {
              const stat = await fs.promises.stat(targetDir);
              if (!stat.isDirectory()) {
                console.log(pc.red(`\n❌ Error: "${arg}" is not a directory.\n`));
                continue;
              }
            } catch (err) {
              console.log(pc.red(`\n❌ Error: Directory "${arg}" does not exist.\n`));
              continue;
            }
          }

          const buildMinimizedContextTree = async (dirPath) => {
            let fileList = [];
            let entries = [];
            try {
              entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
            } catch (err) {
              return [];
            }

            for (const entry of entries) {
              if (ignoreDirs.includes(entry.name)) continue;

              const fullPath = path.join(dirPath, entry.name);
              const relativePath = path.relative(process.cwd(), fullPath);

              if (entry.isDirectory()) {
                try {
                  const subFiles = await buildMinimizedContextTree(fullPath);
                  fileList = fileList.concat(subFiles);
                } catch (e) {
                  // ignore
                }
              } else {
                try {
                  const stats = await fs.promises.stat(fullPath);
                  const sizeKb = (stats.size / 1024).toFixed(1);
                  fileList.push({ path: relativePath, sizeKb });
                } catch (e) {
                  // ignore
                }
              }
            }
            return fileList;
          };

          console.log(pc.yellow(`\n🔍 Scanning folder workspace: ${pc.bold(targetDir)}...`));
          const files = await buildMinimizedContextTree(targetDir);
          if (files.length === 0) {
            console.log(pc.yellow('⚠️  No files found in the specified directory.\n'));
            continue;
          }

          let fileLines = files.map(f => `- ${f.path} (${f.sizeKb} KB)`).join('\n');
          const contextMsg = `[Workspace Local Files Context]\nBelow is the directory tree of the project workspace starting at folder "${path.relative(process.cwd(), targetDir) || '.'}" containing all local files that are available for you to read, modify, or act upon:\n\n${fileLines}\n\nUse this index to locate files and fulfill user instructions. You can use your filesystem tools (like readFile, searchReplace, writeFile, etc.) to view or edit these files.`;

          let session = null;
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
            try {
              session = await sessionService.createSession({
                appName: 'plumar-cli',
                userId: 'default-user',
                sessionId: sessionId
              });
            } catch (e) {
              console.log(pc.red(`❌ Error: Active session could not be created: ${e.message}\n`));
              continue;
            }
          }

          if (!session) {
            console.log(pc.red('❌ Error: Active session could not be retrieved.\n'));
            continue;
          }

          await sessionService.appendEvent({
            session,
            event: {
              role: 'user',
              timestamp: Date.now(),
              content: contextMsg
            }
          });

          console.log(pc.green(`\n✔ Successfully minimized and loaded folder index into the active session context!`));
          console.log(`  • ${pc.bold('Folder Scanned')}: ${pc.cyan(path.relative(process.cwd(), targetDir) || '.')}`);
          console.log(`  • ${pc.bold('Files Scanned')}:  ${pc.cyan(files.length)}`);
          console.log(`  • ${pc.bold('Session ID')}:     ${pc.cyan(sessionId)}\n`);
          continue;
        }
        
        else if (command === '/help') {
          printHelp(arg);
          continue;
        } 
        
        else if (command === '/features') {
          printFeatures();
          continue;
        }
        
        else if (command === '/tools') {
          printTools(tools);
          continue;
        } 

        else if (command === '/samples') {
          printSamples(tools);
          continue;
        } 
        
        else if (command === '/skills') {
          const { getLoadedSkills } = await import('./src/skills-plugins-manager.js');
          printSkills(getLoadedSkills());
          continue;
        }

        else if (command === '/add-skill') {
          const { createSkill } = await import('./src/skills-plugins-manager.js');
          console.log(pc.yellow('\n🎓 Create a New Custom Agentic Skill'));
          const name = await rl.question(pc.cyan('Enter skill name (lowercase kebab-case/snake_case) › '));
          const trimmedName = name.trim();
          if (!trimmedName) {
            console.log(pc.red('❌ Cancelled: Skill name cannot be empty.\n'));
            continue;
          }
          const description = await rl.question(pc.cyan('Enter short skill description › '));
          const trimmedDesc = description.trim();
          if (!trimmedDesc) {
            console.log(pc.red('❌ Cancelled: Description cannot be empty.\n'));
            continue;
          }
          const tagsInput = await rl.question(pc.cyan('Enter tags (comma-separated, optional) › '));
          const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
          
          console.log(pc.cyan('Enter detailed markdown instructions for this skill (type "END" on a new line when done):'));
          const instructionsLines = [];
          while (true) {
            const line = await rl.question('');
            if (line.trim() === 'END') {
              break;
            }
            instructionsLines.push(line);
          }
          const instructions = instructionsLines.join('\n').trim();
          if (!instructions) {
            console.log(pc.red('❌ Cancelled: Instructions cannot be empty.\n'));
            continue;
          }
          
          try {
            const skill = await createSkill(trimmedName, trimmedDesc, tags, instructions);
            console.log(pc.green(`✔ Skill "${pc.bold(skill.name)}" created successfully!\n`));
          } catch (err) {
            console.log(pc.red(`❌ Failed to create skill: ${err.message}\n`));
          }
          continue;
        }

        else if (command === '/plugins') {
          const { getLoadedPlugins } = await import('./src/skills-plugins-manager.js');
          printPlugins(getLoadedPlugins());
          continue;
        }

        else if (command === '/add-plugin') {
          const { createPlugin } = await import('./src/skills-plugins-manager.js');
          console.log(pc.yellow('\n🔌 Create a New Custom JavaScript Plugin'));
          const fileName = await rl.question(pc.cyan('Enter file name (e.g. "my-tool.js") › '));
          const trimmedFile = fileName.trim();
          if (!trimmedFile) {
            console.log(pc.red('❌ Cancelled: File name cannot be empty.\n'));
            continue;
          }
          
          const defaultCode = `import { FunctionTool } from '@google/adk';
import { z } from 'zod';

export const tool = new FunctionTool({
  name: '${trimmedFile.replace('.js', '')}',
  description: 'A custom tool registered via code plugin',
  parameters: z.object({
    message: z.string().describe('The message to print')
  }),
  execute: async ({ message }) => {
    return {
      success: true,
      echo: message
    };
  }
});
`;
          console.log(pc.cyan('Generate template code content automatically? [Y/n]'));
          const autoGen = await rl.question('› ');
          let codeContent = '';
          if (autoGen.toLowerCase().startsWith('n')) {
            console.log(pc.cyan('Enter complete ESM JavaScript code (type "END" on a new line when done):'));
            const codeLines = [];
            while (true) {
              const line = await rl.question('');
              if (line.trim() === 'END') {
                break;
              }
              codeLines.push(line);
            }
            codeContent = codeLines.join('\n').trim();
          } else {
            codeContent = defaultCode;
          }
          
          if (!codeContent) {
            console.log(pc.red('❌ Cancelled: Code content cannot be empty.\n'));
            continue;
          }
          
          try {
            const plugin = await createPlugin(trimmedFile, codeContent);
            console.log(pc.green(`✔ Plugin file "${pc.bold(plugin.fileName)}" created successfully!\n`));
            console.log(pc.yellow('💡 Note: Please restart the CLI to load and activate your new plugin.\n'));
          } catch (err) {
            console.log(pc.red(`❌ Failed to create plugin: ${err.message}\n`));
          }
          continue;
        }
        else if (command === '/info') {
          let eventCount = 0;
          let session = null;
          try {
            session = await sessionService.getSession({
              appName: 'plumar-cli',
              userId: 'default-user',
              sessionId: sessionId
            });
            if (session) {
              eventCount = session.events.length;
            }
          } catch (e) {
            // ignore
          }

          if (arg === 'json' || arg === '--json' || arg === '-j') {
            console.log(pc.yellow('\n📊 Session Diagnostics (JSON):'));
            console.log(JSON.stringify({
              activeModel,
              activeMode,
              activeTemperature,
              sessionId,
              workspaceRoot: process.cwd(),
              llmProvider: getLlmProvider(),
              serverEndpoint: getOllamaBaseUrl(),
              serverAuth: getOllamaAuth() ? '******' : 'None',
              verboseJsonLogs: isVerboseJsonEnabled(),
              adkInfoLogs: isAdkInfoEnabled(),
              session
            }, null, 2));
            console.log();
          } else {
            const provider = getLlmProvider();
            const providerName = provider === 'lmstudio' ? 'LM Studio' : 'Ollama';
            const infoData = [
              { label: 'Active Model', value: activeModel },
              { label: 'Temperature', value: activeTemperature !== null ? String(activeTemperature) : 'Default (Mode-defined)' },
              { label: 'Active Chat Mode', value: CHAT_MODES[activeMode] ? (CHAT_MODES[activeMode].emoji ? (CHAT_MODES[activeMode].emoji + ' ' + CHAT_MODES[activeMode].name) : CHAT_MODES[activeMode].name) : activeMode },
              { label: 'ADK Session ID', value: sessionId },
              { label: 'History Events', value: `${eventCount} events` },
              { label: 'Workspace Root', value: process.cwd() },
              { label: 'LLM Provider', value: providerName },
              { label: `${providerName} Endpoint`, value: getOllamaBaseUrl() },
              { label: `${providerName} Auth`, value: getOllamaAuth() ? '****** (Configured)' : 'None' },
              { label: 'Verbose JSON Logs', value: isVerboseJsonEnabled() ? 'ON' : 'OFF' },
              { label: 'ADK Info Logs', value: isAdkInfoEnabled() ? 'ON' : 'OFF' }
            ];
            printSettingsTable('Session Diagnostics', infoData);
          }
          continue;
        } 
        
        else if (command === '/verbose') {
          const current = isVerboseJsonEnabled();
          setVerboseJsonEnabled(!current);
          console.log(pc.green(`✔ Verbose JSON payload logging is now ${pc.bold(isVerboseJsonEnabled() ? 'ENABLED' : 'DISABLED')}.\n`));
          displaySettingsTable();
          continue;
        }

        else if (command === '/adk-info') {
          const current = isAdkInfoEnabled();
          setAdkInfoEnabled(!current);
          console.log(pc.green(`✔ ADK internal info logging is now ${pc.bold(isAdkInfoEnabled() ? 'ENABLED' : 'DISABLED')}.\n`));
          displaySettingsTable();
          continue;
        } 

        else if (command === '/provider') {
          if (!arg) {
            const current = getLlmProvider() === 'lmstudio' ? 'LM Studio' : 'Ollama';
            console.log(`\n🤖 ${pc.bold('Current LLM Provider')}: ${pc.magenta(current)}`);
            const answer = await rl.question(pc.cyan('Enter new provider (1 for Ollama, 2 for LM Studio) › '));
            const trimmed = answer.trim();
            if (trimmed === '1') {
              setLlmProvider('ollama');
            } else if (trimmed === '2') {
              setLlmProvider('lmstudio');
            } else if (trimmed) {
              setLlmProvider(trimmed);
            }
            const resolved = getLlmProvider() === 'lmstudio' ? 'LM Studio' : 'Ollama';
            console.log(pc.green(`✔ LLM Provider successfully switched to: ${pc.bold(resolved)}\n`));
            displaySettingsTable();
          } else {
            setLlmProvider(arg);
            const resolved = getLlmProvider() === 'lmstudio' ? 'LM Studio' : 'Ollama';
            console.log(pc.green(`✔ LLM Provider successfully switched to: ${pc.bold(resolved)}\n`));
            displaySettingsTable();
          }
          continue;
        }

        else if (command === '/settings') {
          const provider = getLlmProvider();
          const providerName = provider === 'lmstudio' ? 'LM Studio' : 'Ollama';
          if (!arg) {
            displaySettingsTable();
            console.log(pc.dim(`To switch LLM provider, use: /settings provider <ollama|lmstudio>`));
            console.log(pc.dim(`To update server endpoint, use: /settings endpoint <url> or /host <url>`));
            console.log(pc.dim(`To update authentication, use: /settings auth <token_or_header>`));
            console.log(pc.dim(`To toggle logs, use: /verbose or /adk-info\n`));
          } else {
            const parts = arg.split(/\s+/).filter(Boolean);
            const key = parts[0].toLowerCase();
            const value = parts.slice(1).join(' ').trim();
            
            if (['provider', 'llm-provider', 'type'].includes(key)) {
              if (!value) {
                console.log(`\n🤖 ${pc.bold('Current LLM Provider')}: ${pc.magenta(getLlmProvider() === 'lmstudio' ? 'LM Studio' : 'Ollama')}`);
                const newProvider = await rl.question(pc.cyan('Enter new provider (1 for Ollama, 2 for LM Studio) › '));
                const trimmed = newProvider.trim();
                if (trimmed === '1') {
                  setLlmProvider('ollama');
                } else if (trimmed === '2') {
                  setLlmProvider('lmstudio');
                } else if (trimmed) {
                  setLlmProvider(trimmed);
                }
                const resolved = getLlmProvider() === 'lmstudio' ? 'LM Studio' : 'Ollama';
                console.log(pc.green(`✔ LLM Provider successfully updated to: ${pc.bold(resolved)}\n`));
                displaySettingsTable();
              } else {
                setLlmProvider(value);
                const resolved = getLlmProvider() === 'lmstudio' ? 'LM Studio' : 'Ollama';
                console.log(pc.green(`✔ LLM Provider successfully updated to: ${pc.bold(resolved)}\n`));
                displaySettingsTable();
              }
            } else if (['ollama', 'endpoint', 'host'].includes(key)) {
              if (!value) {
                console.log(`\n🔌 ${pc.bold(`Current ${providerName} Endpoint`)}: ${pc.magenta(getOllamaBaseUrl())}`);
                const newHost = await rl.question(pc.cyan(`Enter new ${providerName} Host (e.g. http://127.0.0.1:11434) › `));
                const trimmedHost = newHost.trim();
                if (trimmedHost) {
                  setOllamaBaseUrl(trimmedHost);
                  console.log(pc.green(`✔ ${providerName} Endpoint successfully updated to: ${pc.bold(getOllamaBaseUrl())}\n`));
                  displaySettingsTable();
                }
              } else {
                setOllamaBaseUrl(value);
                console.log(pc.green(`✔ ${providerName} Endpoint successfully updated to: ${pc.bold(getOllamaBaseUrl())}\n`));
                displaySettingsTable();
              }
            } else if (['auth', 'token', 'key'].includes(key)) {
              if (!value) {
                console.log(`\n🔑 ${pc.bold(`Current ${providerName} Auth`)}: ${pc.magenta(getOllamaAuth() ? '******' : 'None')}`);
                const newAuth = await rl.question(pc.cyan(`Enter new ${providerName} Auth (e.g. Bearer token, or custom header X-API-Key:key) › `));
                const trimmedAuth = newAuth.trim();
                setOllamaAuth(trimmedAuth);
                console.log(pc.green(`✔ ${providerName} Auth successfully updated.\n`));
                displaySettingsTable();
              } else {
                setOllamaAuth(value);
                console.log(pc.green(`✔ ${providerName} Auth successfully updated.\n`));
                displaySettingsTable();
              }
            } else if (key === 'verbose') {
              if (['on', 'true', 'yes'].includes(value.toLowerCase())) {
                setVerboseJsonEnabled(true);
                console.log(pc.green(`✔ Verbose JSON logs enabled.\n`));
              } else if (['off', 'false', 'no'].includes(value.toLowerCase())) {
                setVerboseJsonEnabled(false);
                console.log(pc.green(`✔ Verbose JSON logs disabled.\n`));
              } else {
                setVerboseJsonEnabled(!isVerboseJsonEnabled());
                console.log(pc.green(`✔ Verbose JSON logs toggled to: ${pc.bold(isVerboseJsonEnabled() ? 'ON' : 'OFF')}\n`));
              }
              displaySettingsTable();
            } else if (key === 'adk-info') {
              if (['on', 'true', 'yes'].includes(value.toLowerCase())) {
                setAdkInfoEnabled(true);
                console.log(pc.green(`✔ ADK Info logs enabled.\n`));
              } else if (['off', 'false', 'no'].includes(value.toLowerCase())) {
                setAdkInfoEnabled(false);
                console.log(pc.green(`✔ ADK Info logs disabled.\n`));
              } else {
                setAdkInfoEnabled(!isAdkInfoEnabled());
                console.log(pc.green(`✔ ADK Info logs toggled to: ${pc.bold(isAdkInfoEnabled() ? 'ON' : 'OFF')}\n`));
              }
              displaySettingsTable();
            } else if (key === 'policy') {
              if (['allow', 'ask', 'deny'].includes(value.toLowerCase())) {
                setDefaultPolicy(value.toLowerCase());
                console.log(pc.green(`✔ Default tool policy set to: ${pc.bold(value.toUpperCase())}\n`));
                displaySettingsTable();
              } else {
                console.log(pc.red(`❌ Invalid policy. Choose from: allow, ask, deny\n`));
              }
            } else {
              console.log(pc.red(`❌ Unknown settings key: "${key}".\nAvailable keys: ollama, auth, verbose, adk-info, policy\n`));
            }
          }
          continue;
        }
        
        else if (command === '/policy') {
          const args = arg.split(/\s+/).filter(Boolean);
          const formatPolicy = (p) => p === 'allow' ? pc.green('ALLOW') : p === 'ask' ? pc.yellow('ASK') : pc.red('DENY');
          
          if (args.length === 0) {
            // Display all policies
            console.log(pc.bold(pc.yellow('\n🛡️  Tool Execution Policies:')));
            console.log(`  • ${pc.bold('Default Policy')}: ${formatPolicy(getDefaultPolicy())}`);
            
            const activeConfig = getActivePolicyConfigFile();
            if (activeConfig) {
              console.log(`  • ${pc.bold('Config File')}:    ${pc.blue(activeConfig)}`);
            } else {
              console.log(`  • ${pc.bold('Config File')}:    ${pc.dim('None (In-Memory Only)')}`);
            }
            console.log();
            
            console.log(pc.bold(pc.cyan('┌──────────────────────────────────────────────────┬──────────┐')));
            console.log(pc.bold(pc.cyan('│ Tool Name                                        │ Policy   │')));
            console.log(pc.bold(pc.cyan('├──────────────────────────────────────────────────┼──────────┤')));
            
            Object.keys(tools).sort().forEach(name => {
              const policy = getToolPolicy(name);
              const isOverride = getAllToolPolicies().overrides[name] !== undefined;
              const policyStr = isOverride ? pc.bold(formatPolicy(policy)) : pc.dim(formatPolicy(policy));
              console.log(pc.bold(pc.cyan('│ ')) + name.padEnd(48) + pc.bold(pc.cyan(' │ ')) + policyStr.padEnd(18) + pc.bold(pc.cyan('│')));
            });
            
            console.log(pc.bold(pc.cyan('└──────────────────────────────────────────────────┴──────────┘')));
            console.log();
            console.log(`💡 To change policy: ${pc.yellow('/policy [default|<tool_name>] [allow|ask|deny]')}`);
            console.log(`💡 To manage config: ${pc.yellow('/policy config [filepath]')}\n`);
          } else if (args[0].toLowerCase() === 'config') {
            if (args.length === 1) {
              const activeConfig = getActivePolicyConfigFile();
              if (activeConfig) {
                console.log(pc.green(`\n✔ Active policy config file: ${pc.bold(activeConfig)}\n`));
              } else {
                console.log(pc.yellow(`\n🛡️  No active policy config file. Policies are kept in memory only.`));
                console.log(`💡 To save policies to a file, run: ${pc.yellow('/policy config policy-config.json')}\n`);
              }
            } else {
              const filepath = args[1];
              if (fs.existsSync(filepath)) {
                loadPolicyConfig(filepath);
                console.log(pc.green(`\n✔ Policy configuration successfully loaded from: ${pc.bold(filepath)}\n`));
              } else {
                savePolicyConfig(filepath);
                console.log(pc.green(`\n✔ Created and initialized new policy config file with current settings at: ${pc.bold(filepath)}\n`));
              }
            }
          } else if (args.length === 1) {
            const target = args[0].toLowerCase();
            if (['allow', 'ask', 'deny'].includes(target)) {
              setDefaultPolicy(target);
              console.log(pc.green(`✔ Default tool execution policy successfully changed to: ${pc.bold(target.toUpperCase())}\n`));
            } else {
              const resolvedToolName = Object.keys(tools).find(t => t.toLowerCase() === target);
              if (resolvedToolName) {
                const policy = getToolPolicy(resolvedToolName);
                const isOverride = getAllToolPolicies().overrides[resolvedToolName] !== undefined;
                console.log(`\n🛡️  Policy for "${pc.bold(resolvedToolName)}": ${formatPolicy(policy)} ${isOverride ? pc.dim('(Override)') : pc.dim('(Default)')}\n`);
              } else {
                console.log(pc.red(`❌ Unknown tool or policy option: "${target}".\n`));
              }
            }
          } else {
            const target = args[0];
            const policy = args[1].toLowerCase();
            
            if (!['allow', 'ask', 'deny'].includes(policy)) {
              console.log(pc.red(`❌ Invalid policy option: "${policy}". Must be allow, ask, or deny.\n`));
            } else if (target.toLowerCase() === 'default') {
              setDefaultPolicy(policy);
              console.log(pc.green(`✔ Default tool execution policy successfully changed to: ${pc.bold(policy.toUpperCase())}\n`));
            } else {
              const resolvedToolName = Object.keys(tools).find(t => t.toLowerCase() === target.toLowerCase());
              if (resolvedToolName) {
                setToolPolicy(resolvedToolName, policy);
                console.log(pc.green(`✔ Tool "${pc.bold(resolvedToolName)}" policy successfully set to: ${pc.bold(policy.toUpperCase())}\n`));
              } else {
                console.log(pc.red(`❌ Unknown tool: "${target}".\n`));
              }
            }
          }
          continue;
        }
        
        else if (command === '/host') {
          const provider = getLlmProvider();
          const providerName = provider === 'lmstudio' ? 'LM Studio' : 'Ollama';
          if (!arg) {
            console.log(`\n🔌 ${pc.bold(`Current ${providerName} Endpoint`)}: ${pc.magenta(getOllamaBaseUrl())}`);
            const defaultUrl = provider === 'lmstudio' ? 'http://127.0.0.1:1234' : 'http://127.0.0.1:11434';
            const newHost = await rl.question(pc.cyan(`Enter new ${providerName} Host (e.g. ${defaultUrl}) › `));
            const trimmedHost = newHost.trim();
            if (trimmedHost) {
              setOllamaBaseUrl(trimmedHost);
              console.log(pc.green(`✔ ${providerName} Endpoint successfully updated to: ${pc.bold(getOllamaBaseUrl())}\n`));
              displaySettingsTable();
            }
          } else {
            setOllamaBaseUrl(arg);
            console.log(pc.green(`✔ ${providerName} Endpoint successfully updated to: ${pc.bold(getOllamaBaseUrl())}\n`));
            displaySettingsTable();
          }
          continue;
        }
        
        else if (command === '/mode') {
          // Note: Users can add or customize chat modes in ./.plumar/settings.json
          if (!arg) {
            // No argument provided, show modes menu and prompt selection
            printModes(CHAT_MODES, activeMode);
            const modeAnswer = await rl.question(pc.green(pc.bold('Select mode by key › ')));
            const selectedKey = modeAnswer.trim().toLowerCase();
            
            if (CHAT_MODES[selectedKey]) {
              activeMode = selectedKey;
              console.clear();
              printBanner();
              printStatus(activeModel, activeMode, CHAT_MODES[activeMode], activeTemperature);
              console.log(pc.green(`✔ Mode successfully switched to: ${pc.bold(CHAT_MODES[activeMode].name)}\n`));
            } else if (selectedKey) {
              console.log(pc.red(`❌ Unknown mode key: "${selectedKey}". Switch cancelled.\n`));
            }
          } else {
            // Direct switch via command, e.g. /mode code
            const selectedKey = arg.toLowerCase();
            if (CHAT_MODES[selectedKey]) {
              activeMode = selectedKey;
              console.clear();
              printBanner();
              printStatus(activeModel, activeMode, CHAT_MODES[activeMode], activeTemperature);
              console.log(pc.green(`✔ Mode switched to: ${pc.bold(CHAT_MODES[activeMode].name)}\n`));
            } else {
              console.log(pc.red(`❌ Unknown mode: "${selectedKey}". Type ${pc.yellow('/mode')} to list available modes.\n`));
            }
          }
          continue;
        } 
        
        else if (command === '/parameter' || command === '/parameters') {
          const subparts = trimmedInput.split(' ').filter(Boolean);
          const action = subparts[1] ? subparts[1].toLowerCase() : 'list';
          const paramName = subparts[2] ? subparts[2].toLowerCase() : null;
          const paramValue = subparts.slice(3).join(' ').trim();

          if (action === 'list') {
            console.log(`\n⚙️  ${pc.bold('Active Session Ollama Parameters')} for Model ${pc.bold(activeModel)}:`);
            console.log(pc.bold(pc.cyan('┌─────────────────┬──────────────────────┬──────────────────────┬──────────────────────┐')));
            console.log(pc.bold(pc.cyan('│ Parameter Name  │ Current Mode Value   │ Session Override     │ Resolved Value       │')));
            console.log(pc.bold(pc.cyan('├─────────────────┼──────────────────────┼──────────────────────┼──────────────────────┤')));
            
            const currentModeMeta = CHAT_MODES[activeMode] || {};
            ALLOWED_PARAMETERS.forEach(p => {
              const rawModeVal = currentModeMeta[p] !== undefined ? JSON.stringify(currentModeMeta[p]) : 'not set';
              const rawOverrideVal = activeParameters[p] !== undefined ? JSON.stringify(activeParameters[p]) : 'not set';
              
              let rawResolved = 'Ollama default';
              if (activeParameters[p] !== undefined) {
                rawResolved = JSON.stringify(activeParameters[p]);
              } else if (currentModeMeta[p] !== undefined) {
                rawResolved = JSON.stringify(currentModeMeta[p]);
              }
              
              // Style the values
              const modeValStyle = currentModeMeta[p] !== undefined ? pc.yellow(rawModeVal) : pc.dim(rawModeVal);
              const overrideValStyle = activeParameters[p] !== undefined ? pc.green(pc.bold(rawOverrideVal)) : pc.dim(rawOverrideVal);
              
              let resolvedStyle = pc.dim(rawResolved);
              if (activeParameters[p] !== undefined) {
                resolvedStyle = pc.green(pc.bold(rawResolved));
              } else if (currentModeMeta[p] !== undefined) {
                resolvedStyle = pc.yellow(rawResolved);
              }

              // Pad the styled columns by adjusting for their ANSI-stripped length
              const col1 = p.padEnd(15);
              const col2 = modeValStyle + ' '.repeat(Math.max(0, 20 - rawModeVal.length));
              const col3 = overrideValStyle + ' '.repeat(Math.max(0, 20 - rawOverrideVal.length));
              const col4 = resolvedStyle + ' '.repeat(Math.max(0, 20 - rawResolved.length));

              console.log(pc.bold(pc.cyan('│ ')) + col1 + pc.bold(pc.cyan(' │ ')) + col2 + pc.bold(pc.cyan(' │ ')) + col3 + pc.bold(pc.cyan(' │ ')) + col4 + pc.bold(pc.cyan('│')));
            });
            console.log(pc.bold(pc.cyan('└─────────────────┴──────────────────────┴──────────────────────┴──────────────────────┘')));
            console.log(`💡 Usage: ${pc.yellow('/parameter set <name> <value>')} or ${pc.yellow('/parameter get <name>')}\n`);
          } else if (action === 'get') {
            if (!paramName) {
              console.log(pc.red(`❌ Missing parameter name. Usage: ${pc.yellow('/parameter get [parameter name]')}\n`));
              continue;
            }
            if (!ALLOWED_PARAMETERS.includes(paramName)) {
              console.log(pc.red(`❌ Unknown parameter: "${paramName}". Allowed parameters are:\n   ${ALLOWED_PARAMETERS.join(', ')}\n`));
              continue;
            }
            
            const currentModeMeta = CHAT_MODES[activeMode] || {};
            const overrideVal = activeParameters[paramName];
            const modeVal = currentModeMeta[paramName];
            
            console.log(`\n🔍 ${pc.bold('Parameter ' + pc.yellow(paramName))}:`);
            if (overrideVal !== undefined) {
              console.log(`  • Session Override: ${pc.green(pc.bold(JSON.stringify(overrideVal)))}`);
            } else {
              console.log(`  • Session Override: ${pc.dim('not set')}`);
            }
            if (modeVal !== undefined) {
              console.log(`  • Current Mode Default: ${pc.yellow(JSON.stringify(modeVal))}`);
            } else {
              console.log(`  • Current Mode Default: ${pc.dim('not set')}`);
            }
            
            const resolved = overrideVal !== undefined ? overrideVal : (modeVal !== undefined ? modeVal : 'Ollama default');
            console.log(`  • Resolved Value: ${pc.cyan(pc.bold(JSON.stringify(resolved)))}\n`);
          } else if (action === 'set') {
            if (!paramName) {
              console.log(pc.red(`❌ Missing parameter name. Usage: ${pc.yellow('/parameter set [parameter name] [value]')}\n`));
              continue;
            }
            if (!ALLOWED_PARAMETERS.includes(paramName)) {
              console.log(pc.red(`❌ Unknown parameter: "${paramName}". Allowed parameters are:\n   ${ALLOWED_PARAMETERS.join(', ')}\n`));
              continue;
            }
            if (!paramValue) {
              // Reset the parameter to mode default (delete from override)
              delete activeParameters[paramName];
              if (paramName === 'temperature') {
                activeTemperature = null;
              }
              console.log(pc.green(`✔ Parameter "${pc.bold(paramName)}" has been reset to mode defaults.\n`));
              continue;
            }
            
            // Cast and validate
            const casted = castParameter(paramName, paramValue);
            if (casted === null) {
              console.log(pc.red(`❌ Invalid value "${paramValue}" for parameter "${paramName}".\n`));
              continue;
            }
            
            activeParameters[paramName] = casted;
            if (paramName === 'temperature') {
              activeTemperature = casted;
            }
            console.log(pc.green(`✔ Parameter "${pc.bold(paramName)}" successfully set to: ${pc.bold(JSON.stringify(casted))}\n`));
          } else {
            console.log(pc.red(`❌ Unknown action "${action}". Usage: ${pc.yellow('/parameter [list|set|get] [parameter name] [value]')}\n`));
          }
          continue;
        } 
        
        else if (command === '/model') {
          try {
            const result = await runModelSelectionFlow(rl, false, activeModel);
            if (result) {
              activeModel = result.selectedModel;

              // Prompt for temperature
              let tempAnswer = await rl.question(pc.cyan('Enter temperature (0.0 - 1.0, or press [Enter] for default) › '));
              tempAnswer = tempAnswer.trim();
              if (tempAnswer) {
                const parsedTemp = parseFloat(tempAnswer);
                if (!isNaN(parsedTemp) && parsedTemp >= 0 && parsedTemp <= 1.0) {
                  activeTemperature = parsedTemp;
                } else {
                  console.log(pc.yellow(`⚠️  Invalid temperature. Using profile default.`));
                  activeTemperature = null;
                }
              } else {
                activeTemperature = null;
              }

              console.clear();
              printBanner();
              printStatus(activeModel, activeMode, CHAT_MODES[activeMode], activeTemperature);
              console.log(pc.green(`✔ Model successfully changed to: ${pc.bold(activeModel)}\n`));
            } else {
              console.log(pc.yellow('⚠️  Model switch cancelled.\n'));
            }
          } catch (err) {
            console.log(pc.red(`❌ Failed to run model selection: ${err.message}\n`));
          }
          continue;
        } 
        
        else {
          console.log(pc.red(`❌ Unknown command: ${command}. Type ${pc.yellow('/help')} for a list of commands.\n`));
          continue;
        }
      }

      // Prepare the abort controller for execution cancellation
      const controller = new AbortController();
      const oldRawMode = process.stdin.isRaw;
      const startTime = Date.now();

      const keypressHandler = (chunk, key) => {
        if (key) {
          if (key.name === 'escape') {
            // Ignore keypresses within 100ms of entering raw mode to avoid triggering
            // on buffered escape characters or ANSI sequences from Enter/cursor actions
            if (Date.now() - startTime > 100) {
              controller.abort();
            }
          } else if (key.ctrl && key.name === 'c') {
            shutdown();
          }
        }
      };

      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(true);
      }
      process.stdin.on('keypress', keypressHandler);
      process.stdin.resume();

      try {
        let finalPrompt = trimmedInput;
        const pipeMatch = parsePromptPiping(trimmedInput);
        if (pipeMatch.command) {
          if (pipeMatch.prompt === '') {
            // Direct command execution bypass! No AI model call, just execute and present the output.
            console.log(pc.yellow(`\n⚙️  Executing shell command: ${pc.bold(pipeMatch.command)}... (Press ESC to cancel)`));
            const shellOutput = await executePipeCommand(pipeMatch.command, controller.signal);
            if (controller.signal.aborted) {
              throw new Error('Request cancelled by user (ESC)');
            }
            console.log(shellOutput);
            console.log();
            continue;
          }

          console.log(pc.yellow(`\n⚙️  Executing shell command: ${pc.bold(pipeMatch.command)}... (Press ESC to cancel)`));
          const shellOutput = await executePipeCommand(pipeMatch.command, controller.signal);
          if (controller.signal.aborted) {
            throw new Error('Request cancelled by user (ESC)');
          }
          console.log(pc.green(`✔ Captured shell output (${shellOutput.length} characters)`));

          let showAnswer = '';
          if (alwaysShowOutput === true) {
            showAnswer = 'y';
          } else if (alwaysShowOutput === false) {
            showAnswer = 'n';
          } else {
            // Disable raw mode temporarily so rl.question works normally
            if (process.stdin.setRawMode) {
              process.stdin.setRawMode(false);
            }

            showAnswer = await rl.question(pc.cyan('❓ Show captured output? (y/n/Y/N) [y/N] › '));

            // Re-enable raw mode for the rest of execution
            if (process.stdin.setRawMode) {
              process.stdin.setRawMode(true);
            }

            const trimmedAnswer = showAnswer.trim().toUpperCase();
            if (trimmedAnswer === 'Y' || trimmedAnswer === 'YES') {
              alwaysShowOutput = true;
            } else if (trimmedAnswer === 'N' || trimmedAnswer === 'NO') {
              alwaysShowOutput = false;
            }
          }

          if (showAnswer.trim().toLowerCase().startsWith('y')) {
            console.log(pc.dim('\n--- Captured Output ---'));
            console.log(shellOutput);
            console.log(pc.dim('-----------------------\n'));
          }

          finalPrompt = `${pipeMatch.prompt}\n\n### Shell Output of \`${pipeMatch.command}\`:\n\`\`\`\n${shellOutput}\n\`\`\``;
        }

        let sessionEvents = [];
        try {
          const session = await sessionService.getSession({
            appName: 'plumar-cli',
            userId: 'default-user',
            sessionId: sessionId
          });
          if (session && session.events) {
            sessionEvents = session.events;
          }
        } catch (e) {
          // ignore
        }

        const sessionBytes = Buffer.byteLength(JSON.stringify(sessionEvents), 'utf8');
        const sessionKb = sessionBytes / 1024;

        console.log(pc.dim(`\n🤖 Agent [${CHAT_MODES[activeMode].name}] is thinking & executing tools using ${activeModel}... (Press ESC to cancel)`));
        if (sessionKb > 35 || sessionEvents.length >= 12) {
          console.log(pc.dim(`   💡 ${pc.yellow('Tip:')} Your conversation context is getting large (${sessionKb.toFixed(1)} KB, ${sessionEvents.length} events).`));
          console.log(pc.dim(`      If generation is slow, run the ${pc.yellow('/minimize')} command to prune and compress history.`));
        }

        const { text, steps } = await runAgentTurn(sessionId, finalPrompt, activeModel, activeMode, controller.signal, activeTemperature, activeParameters);

        if (controller.signal.aborted) {
          throw new Error('Request cancelled by user (ESC)');
        }

        console.log(); // Clear space after potential tool execution logs
        
        // Print the extracted thinking process beautifully if any was generated
        printThinkingProcess(steps);

        // Print final assistant response text
        const formattedText = text.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
        const processedText = formatChatResponse(formattedText);
        console.log(`${pc.magenta(pc.bold(`🤖 ${CHAT_MODES[activeMode].name} › `))} ${processedText}\n`);

      } catch (error) {
        console.log('\n');
        if (controller.signal.aborted || error.message.includes('cancelled by user')) {
          console.log(pc.red(pc.bold('🛑 Request cancelled by user (ESC).\n')));
        } else if (error.name === 'AbortError' || error.name === 'TimeoutError' || error.message.toLowerCase().includes('timeout')) {
          console.error(pc.red(pc.bold('❌ Error executing agent turn:')));
          console.error(pc.red(`   Request timed out or connection lost. The model failed to return content.`));
          console.log(pc.yellow(`\n💡 Tip: Check if your local LLM server (Ollama/LM Studio) is running, responsive, and has enough resources to run model "${activeModel}".\n`));
        } else {
          console.error(pc.red(pc.bold('❌ Error executing agent turn:')));
          console.error(pc.red(`   ${error.message}`));
          console.log(pc.yellow(`\n💡 Tip: Check if Ollama is active and model "${activeModel}" is fully loaded.\n`));
        }
      } finally {
        process.stdin.removeListener('keypress', keypressHandler);
        if (process.stdin.setRawMode) {
          process.stdin.setRawMode(oldRawMode || false);
        }
      }
    }
  } catch (error) {
    console.error(pc.red(`Critical error: ${error.message}`));
    shutdown();
  }
}

import('url').then(({ fileURLToPath }) => {
  const isMain = process.argv[1] && (
    fileURLToPath(import.meta.url) === process.argv[1] ||
    fileURLToPath(import.meta.url).endsWith(process.argv[1]) ||
    process.argv[1].endsWith('index.js') ||
    process.argv[1].endsWith('plumar') ||
    process.argv[1].endsWith('plumar-cli')
  );
  if (isMain) {
    main();
  }
});
