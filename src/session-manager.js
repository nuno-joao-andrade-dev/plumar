import { InMemorySessionService } from '@google/adk';
import fs from 'fs/promises';
import path from 'path';
import pc from 'picocolors';

/**
 * Clean and sanitize sessionId to prevent path traversal
 */
function sanitizeSessionId(sessionId) {
  if (typeof sessionId !== 'string') return '';
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Resolve the Ollama server base URL from environment or fallback to localhost
 */
function getOllamaBaseUrl() {
  let host = process.env.OLLAMA_HOST || 'http://localhost:11434';
  if (!host.startsWith('http://') && !host.startsWith('https://')) {
    host = 'http://' + host;
  }
  if (host.endsWith('/')) {
    host = host.slice(0, -1);
  }
  return host;
}

/**
 * Safely and heuristically truncates a very large string to keep history intact
 * while significantly reducing payload size.
 */
function localHeuristicMinimize(contentStr) {
  if (!contentStr || typeof contentStr !== 'string') return contentStr;
  if (contentStr.length <= 1024) return contentStr;

  const keepChars = 500;
  const prefix = contentStr.slice(0, keepChars);
  const suffix = contentStr.slice(-keepChars);
  const removedCount = contentStr.length - (keepChars * 2);

  return `${prefix}\n\n... [Heuristically truncated ${removedCount} characters of verbose content to preserve history] ...\n\n${suffix}`;
}

/**
 * A highly robust file-persisted session service extending ADK's InMemorySessionService.
 * Seamlessly manages session files inside the workspace sandbox under .antigravitycli/sessions.
 */
export class PersistentFileSessionService extends InMemorySessionService {
  constructor(storageDir) {
    super();
    this.storageDir = storageDir || path.join(process.cwd(), '.antigravitycli', 'sessions');
    this._initialized = false;
  }

  /**
   * Initialize and load any existing session files on disk
   */
  async init() {
    if (this._initialized) return;

    try {
      await fs.mkdir(this.storageDir, { recursive: true });
      const files = await fs.readdir(this.storageDir);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.storageDir, file);
          try {
            const content = await fs.readFile(filePath, 'utf8');
            const session = JSON.parse(content);
            
            if (session && session.id && session.appName && session.userId) {
              const { appName, userId, id } = session;
              
              if (!this.sessions[appName]) {
                this.sessions[appName] = {};
              }
              if (!this.sessions[appName][userId]) {
                this.sessions[appName][userId] = {};
              }
              this.sessions[appName][userId][id] = session;
            }
          } catch (err) {
            // Silently ignore corrupted session files
          }
        }
      }
    } catch (err) {
      // Ignore initial directory read/creation errors
    }
    
    this._initialized = true;
  }

  /**
   * Helper to ensure the service is fully loaded on any on-demand method call
   */
  async ensureInitialized() {
    if (!this._initialized) {
      await this.init();
    }
  }

  /**
   * Persistently serialize an in-memory session to its JSON file representation
   */
  async saveSessionToDisk(appName, userId, sessionId) {
    await this.ensureInitialized();
    
    const sanitizedId = sanitizeSessionId(sessionId);
    if (!sanitizedId) return;

    if (!this.sessions[appName] || !this.sessions[appName][userId] || !this.sessions[appName][userId][sanitizedId]) {
      return;
    }

    const session = this.sessions[appName][userId][sanitizedId];
    const fileName = `${appName}-${userId}-${sanitizedId}.json`.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filePath = path.join(this.storageDir, fileName);
    
    await fs.writeFile(filePath, JSON.stringify(session, null, 2), 'utf8');
  }

  // --- Overridden InMemorySessionService Methods ---

  async createSession({ appName, userId, state, sessionId }) {
    await this.ensureInitialized();
    const session = await super.createSession({ appName, userId, state, sessionId });
    await this.saveSessionToDisk(appName, userId, session.id);
    return session;
  }

  async getSession({ appName, userId, sessionId, config }) {
    await this.ensureInitialized();
    return await super.getSession({ appName, userId, sessionId, config });
  }

  async listSessions({ appName, userId, limit, offset, page, order }) {
    await this.ensureInitialized();
    return await super.listSessions({ appName, userId, limit, offset, page, order });
  }

  async appendEvent({ session, event }) {
    await this.ensureInitialized();
    const res = await super.appendEvent({ session, event });
    await this.saveSessionToDisk(session.appName, session.userId, session.id);
    return res;
  }

  async deleteSession({ appName, userId, sessionId }) {
    await this.ensureInitialized();
    
    await super.deleteSession({ appName, userId, sessionId });
    
    const sanitizedId = sanitizeSessionId(sessionId);
    if (sanitizedId) {
      const fileName = `${appName}-${userId}-${sanitizedId}.json`.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filePath = path.join(this.storageDir, fileName);
      try {
        await fs.unlink(filePath);
      } catch (err) {
        // Ignore deletion errors if file doesn't exist
      }
    }
  }

  /**
   * Minimizes the specified session in-memory and on-disk to keep only the most recent N events.
   * If a model name is provided, asks the model to summarize the older events first and prepends the summary.
   */
  async minimizeSession(appName, userId, sessionId, targetKeep = 10, modelName = null) {
    await this.ensureInitialized();
    const sanitizedId = sanitizeSessionId(sessionId);
    if (!sanitizedId) return null;

    if (!this.sessions[appName] || !this.sessions[appName][userId] || !this.sessions[appName][userId][sanitizedId]) {
      return null;
    }

    const session = this.sessions[appName][userId][sanitizedId];
    if (!session || !session.events) {
      return null;
    }

    const initialCount = session.events.length;
    const initialBytes = Buffer.byteLength(JSON.stringify(session.events), 'utf8');
    const initialKb = (initialBytes / 1024).toFixed(1);

    // --- OPTION A: Tool-Result Stripping (Selective Metadata Pruning) ---
    // Identify the boundaries of the conversational turns to ensure we keep the recent turns intact.
    const userIndices = [];
    session.events.forEach((ev, idx) => {
      if (ev.role === 'user') {
        userIndices.push(idx);
      }
    });

    // Keep the last 2 turns completely intact.
    const boundaryIndex = userIndices.length >= 2 ? userIndices[userIndices.length - 2] : 0;

    let strippedAny = false;
    let totalBytesSaved = 0;

    for (let idx = 0; idx < session.events.length; idx++) {
      const isOldEvent = idx < boundaryIndex || (idx < session.events.length - 2);
      if (!isOldEvent) continue;

      const ev = session.events[idx];
      
      // Check if it's a tool result
      const isToolResult = ev.type === 'tool_result' || (ev.parts && ev.parts.some(p => p.functionResponse));
      if (!isToolResult) continue;

      if (ev.parts && Array.isArray(ev.parts)) {
        for (const part of ev.parts) {
          if (part.functionResponse && part.functionResponse.response) {
            const originalResponse = part.functionResponse.response;
            if (originalResponse._omitted) continue; // Already stripped

            const resStr = JSON.stringify(originalResponse);
            if (resStr.length > 200) { // Only strip if it's substantial
              const sizeBefore = resStr.length;
              
              const minimizedResponse = {
                success: originalResponse.success !== false,
                message: originalResponse.message || `[Raw tool response data of ${part.functionResponse.name} omitted to save space: originally ${(sizeBefore / 1024).toFixed(1)} KB]`,
                _omitted: true
              };

              // Retain key descriptive properties that might be useful for LLM logic
              if (originalResponse.filePath) minimizedResponse.filePath = originalResponse.filePath;
              if (originalResponse.directoryPath) minimizedResponse.directoryPath = originalResponse.directoryPath;
              if (originalResponse.directory) minimizedResponse.directory = originalResponse.directory;
              if (originalResponse.targetFile) minimizedResponse.targetFile = originalResponse.targetFile;
              if (originalResponse.command) minimizedResponse.command = originalResponse.command;
              if (originalResponse.result !== undefined && typeof originalResponse.result !== 'object') {
                minimizedResponse.result = originalResponse.result; // keep simple primitive results (like math result: 100)
              }

              part.functionResponse.response = minimizedResponse;
              
              const sizeAfter = JSON.stringify(minimizedResponse).length;
              totalBytesSaved += (sizeBefore - sizeAfter);
              strippedAny = true;
            }
          }
        }
      }
    }

    let currentBytes = initialBytes;
    let currentKb = initialKb;
    if (strippedAny) {
      currentBytes = Buffer.byteLength(JSON.stringify(session.events), 'utf8');
      currentKb = (currentBytes / 1024).toFixed(1);
      const savedKb = (totalBytesSaved / 1024).toFixed(1);
      console.log(pc.green(`\n✔ [Local Minimization] Stripped older tool result payloads, saving ${pc.bold(savedKb)} KB of context space!`));
      
      // If we managed to compress the session and it is now safely below 256KB, we can save and exit early!
      if (currentBytes <= 256 * 1024) {
        await this.saveSessionToDisk(appName, userId, sanitizedId);
        return {
          success: true,
          initialCount,
          finalCount: session.events.length,
          initialKb,
          finalKb: currentKb,
          summarized: false,
          toolResultsStripped: true
        };
      }
    }

    let activeKeep = targetKeep;
    if (parseFloat(currentKb) > 256 && initialCount > 2) {
      activeKeep = 2; // Dynamically scale down and keep only last 2 events to summarize the rest of the large payload.
    }

    if (!modelName && initialCount <= activeKeep) {
      if (strippedAny) {
        // If we stripped some tool results and saved space, we still successfully modified the session
        await this.saveSessionToDisk(appName, userId, sanitizedId);
        return {
          success: true,
          initialCount,
          finalCount: session.events.length,
          initialKb,
          finalKb: currentKb,
          summarized: false,
          toolResultsStripped: true
        };
      }
      return {
        success: false,
        initialCount,
        finalCount: initialCount,
        initialKb,
        finalKb: initialKb,
        reason: 'already_minimized'
      };
    }

    let summarizedSuccessfully = false;

    if (modelName) {
      // Helper to minimize a single message content using portion-based chunking if extremely large (>100,000 chars)
      const minimizeSingleMessageContent = async (contentStr, role) => {
        if (!contentStr || typeof contentStr !== 'string') return contentStr;
        if (contentStr.length <= 1024) return contentStr; // Already small

        // Chunk contentStr into portions of around 100,000 characters each to prevent model input overflows
        const lines = contentStr.split('\n');
        const portions = [];
        let currentPortionLines = [];
        let currentPortionChars = 0;
        const MAX_PORTION_CHARS = 100000;

        for (const line of lines) {
          if (currentPortionChars + line.length > MAX_PORTION_CHARS && currentPortionLines.length > 0) {
            portions.push(currentPortionLines.join('\n'));
            currentPortionLines = [line];
            currentPortionChars = line.length;
          } else {
            currentPortionLines.push(line);
            currentPortionChars += line.length + 1;
          }
        }
        if (currentPortionLines.length > 0) {
          portions.push(currentPortionLines.join('\n'));
        }

        const portionSummaries = [];
        let portionIndex = 1;
        let portionFailed = false;

        for (const portionText of portions) {
          const baseUrl = getOllamaBaseUrl();
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 30000);

          try {
            if (portions.length > 1) {
              console.log(pc.yellow(`\n🤖 Asking model ${pc.bold(modelName)} to minimize portion ${portionIndex}/${portions.length} of ${role} message...`));
            } else {
              console.log(pc.yellow(`\n🤖 Asking model ${pc.bold(modelName)} to minimize and compress ${role} message (${(portionText.length / 1024).toFixed(1)} KB)...`));
            }

            const response = await fetch(`${baseUrl}/api/chat`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: modelName,
                messages: [
                  {
                    role: 'system',
                    content: `You are a highly efficient assistant. Your task is to compress and minimize the following ${role} message from a conversation history. Retain all key technical instructions, completed tasks, file paths, code changes, and core queries, but compress the content to be extremely dense, short, and compact to save token space. Respond ONLY with the minimized content. Do not include introductory or concluding conversational filler.`
                  },
                  {
                    role: 'user',
                    content: portionText
                  }
                ],
                stream: false,
                options: {
                  temperature: 0.3
                }
              }),
              signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (response.ok) {
              const data = await response.json();
              const message = data.message || data.choices?.[0]?.message;
              if (message && message.content) {
                portionSummaries.push(message.content.trim());
              } else {
                portionFailed = true;
                break;
              }
            } else {
              portionFailed = true;
              break;
            }
          } catch (err) {
            clearTimeout(timeoutId);
            console.log(pc.red(`\n⚠️  Minimization of portion ${portionIndex} failed (${err.message}).`));
            portionFailed = true;
            break;
          }
          portionIndex++;
        }

        if (!portionFailed && portionSummaries.length > 0) {
          if (portionSummaries.length > 1) {
            const baseUrl = getOllamaBaseUrl();
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);

            try {
              console.log(pc.yellow(`\n🤖 Asking model ${pc.bold(modelName)} to synthesize ${portionSummaries.length} portion summaries for this message...`));
              const response = await fetch(`${baseUrl}/api/chat`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: modelName,
                  messages: [
                    {
                      role: 'system',
                      content: 'You are a highly efficient assistant. Your task is to synthesize the following summaries of parts of a single message into a single, cohesive, highly dense, unified minimized message. Preserve all key technical facts, decisions, and instructions. Respond ONLY with the unified minimized message.'
                    },
                    {
                      role: 'user',
                      content: portionSummaries.join('\n\n---\n\n')
                    }
                  ],
                  stream: false,
                  options: {
                    temperature: 0.3
                  }
                }),
                signal: controller.signal
              });

              clearTimeout(timeoutId);

              if (response.ok) {
                const data = await response.json();
                const message = data.message || data.choices?.[0]?.message;
                if (message && message.content) {
                  return message.content.trim();
                }
              }
            } catch (err) {
              clearTimeout(timeoutId);
              console.log(pc.red(`\n⚠️  Synthesis of message portions failed (${err.message}).`));
            }
          } else {
            return portionSummaries[0];
          }
        }

        return contentStr;
      };

      const minimizedEvents = [];
      let anyMinimizationSucceeded = false;

      for (const ev of session.events) {
        let eventModified = false;
        let updatedEvent = { ...ev };

        if (ev.content && typeof ev.content === 'string' && ev.content.length > 1024) {
          const originalLen = ev.content.length;
          let minimizedText = ev.content;

          try {
            minimizedText = await minimizeSingleMessageContent(ev.content, ev.role || 'user');
          } catch (err) {
            console.log(pc.red(`⚠️  Model minimization failed (${err.message}). Falling back to heuristic truncation.`));
          }

          if (minimizedText === ev.content) {
            minimizedText = localHeuristicMinimize(ev.content);
            console.log(pc.yellow(`✔ Heuristically truncated ${ev.role || 'user'} message: ${(originalLen / 1024).toFixed(1)} KB › ${(minimizedText.length / 1024).toFixed(1)} KB`));
          } else {
            console.log(pc.green(`✔ Minimized ${ev.role || 'user'} message: ${(originalLen / 1024).toFixed(1)} KB › ${(minimizedText.length / 1024).toFixed(1)} KB`));
          }

          if (minimizedText !== ev.content) {
            updatedEvent.content = minimizedText;
            eventModified = true;
          }
        }

        if (ev.parts && Array.isArray(ev.parts)) {
          let partsCopy = null;
          for (let i = 0; i < ev.parts.length; i++) {
            const part = ev.parts[i];
            if (part && part.text && typeof part.text === 'string' && part.text.length > 1024) {
              const originalLen = part.text.length;
              let minimizedText = part.text;

              try {
                minimizedText = await minimizeSingleMessageContent(part.text, ev.role || 'user');
              } catch (err) {
                console.log(pc.red(`⚠️  Model minimization failed (${err.message}). Falling back to heuristic truncation.`));
              }

              if (minimizedText === part.text) {
                minimizedText = localHeuristicMinimize(part.text);
                console.log(pc.yellow(`✔ Heuristically truncated ${ev.role || 'user'} message part [${i}]: ${(originalLen / 1024).toFixed(1)} KB › ${(minimizedText.length / 1024).toFixed(1)} KB`));
              } else {
                console.log(pc.green(`✔ Minimized ${ev.role || 'user'} message part [${i}]: ${(originalLen / 1024).toFixed(1)} KB › ${(minimizedText.length / 1024).toFixed(1)} KB`));
              }

              if (minimizedText !== part.text) {
                if (!partsCopy) {
                  partsCopy = [...ev.parts];
                }
                partsCopy[i] = {
                  ...partsCopy[i],
                  text: minimizedText
                };
                eventModified = true;
              }
            }
          }
          if (partsCopy) {
            updatedEvent.parts = partsCopy;
          }
        }

        if (eventModified) {
          anyMinimizationSucceeded = true;
          minimizedEvents.push(updatedEvent);
        } else {
          minimizedEvents.push(ev);
        }
      }

      if (anyMinimizationSucceeded) {
        summarizedSuccessfully = true;
        session.events = minimizedEvents;
      } else if (session.events.length <= activeKeep) {
        return {
          success: false,
          initialCount,
          finalCount: initialCount,
          initialKb,
          finalKb: initialKb,
          reason: 'already_minimized'
        };
      }
    }

    if (!summarizedSuccessfully) {
      // Fallback to pure structural slicing if we didn't perform model-based summarization,
      // or if model-based summarization has nothing to minimize but session exceeds the limit.
      if (session.events.length > activeKeep) {
        session.events = session.events.slice(-activeKeep);
      }
    }

    const finalCount = session.events.length;
    const finalBytes = Buffer.byteLength(JSON.stringify(session.events), 'utf8');
    const finalKb = (finalBytes / 1024).toFixed(1);

    // Persist to disk
    await this.saveSessionToDisk(appName, userId, sanitizedId);

    return {
      success: true,
      initialCount,
      finalCount,
      initialKb,
      finalKb,
      summarized: summarizedSuccessfully
    };
  }
}

/**
 * Beautifully prints a console table of saved conversation sessions
 */
export function printSessions(sessions, activeSessionId) {
  console.log(pc.bold(pc.yellow('\n📊 Saved Conversation Sessions:')));
  if (sessions.length === 0) {
    console.log(pc.dim('  No saved sessions found. Start chatting to save your first session!'));
    console.log();
    return;
  }

  console.log(pc.bold(pc.magenta('┌─────┬─────────────────────────────────┬──────────────────────┬─────────────┐')));
  console.log(pc.bold(pc.magenta('│  #  │ Session ID                      │ Last Active          │ Status      │')));
  console.log(pc.bold(pc.magenta('├─────┼─────────────────────────────────┼──────────────────────┼─────────────┤')));

  sessions.forEach((session, idx) => {
    const isCurrent = session.id === activeSessionId;
    const marker = isCurrent ? pc.bold(pc.green('● ACTIVE')) : pc.dim('○ idle');
    const indexStr = pc.cyan(`[${idx + 1}]`.padEnd(3));
    const idStr = isCurrent ? pc.bold(pc.green(session.id.padEnd(31))) : session.id.padEnd(31);
    
    let dateStr = 'Unknown';
    if (session.lastUpdateTime) {
      const date = new Date(session.lastUpdateTime);
      dateStr = date.toLocaleString('en-US', { hour12: false });
    }
    const formattedDate = dateStr.padEnd(20);

    console.log(pc.bold(pc.magenta('│ ')) + indexStr + pc.bold(pc.magenta(' │ ')) + idStr + pc.bold(pc.magenta(' │ ')) + formattedDate + pc.bold(pc.magenta(' │ ')) + marker.padEnd(20) + pc.bold(pc.magenta('│')));
  });

  console.log(pc.bold(pc.magenta('└─────┴─────────────────────────────────┴──────────────────────┴─────────────┘')));
  console.log();
}

/**
 * Highly interactive CLI session dashboard manager
 */
export async function runSessionsDashboard(rl, activeSessionId, sessionServiceInstance) {
  console.clear();
  console.log(pc.magenta(pc.bold('┌────────────────────────────────────────────────────────┐')));
  console.log(pc.magenta(pc.bold('│')) + pc.bold(pc.cyan('   📊 PLUMAR SESSION DASHBOARD                        ')) + pc.magenta(pc.bold('│')));
  console.log(pc.magenta(pc.bold('│')) + pc.dim('   Manage, load, inspect and delete saved chat logs   ') + pc.magenta(pc.bold('│')));
  console.log(pc.magenta(pc.bold('└────────────────────────────────────────────────────────┘')));

  while (true) {
    const { sessions } = await sessionServiceInstance.listSessions({
      appName: 'plumar-cli',
      userId: 'default-user',
      order: 'desc'
    });

    printSessions(sessions, activeSessionId);

    console.log(pc.bold('💡 Interactive Actions:'));
    console.log(`  • ${pc.yellow('L <number>')}  : ${pc.bold('Load')} and resume a previous session (e.g. ${pc.yellow('L 1')})`);
    console.log(`  • ${pc.yellow('F <number>')}  : ${pc.bold('Fetch')} and print the conversation history of a session`);
    console.log(`  • ${pc.yellow('D <number>')}  : ${pc.bold('Delete')} a previous session from disk`);
    console.log(`  • ${pc.yellow('B')}           : ${pc.bold('Back')} to the main chat interface\n`);

    const answer = await rl.question(pc.cyan(pc.bold('Dashboard › ')));
    const trimmed = answer.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(/\s+/);
    const action = parts[0].toLowerCase();
    const targetIdxStr = parts[1];

    if (action === 'b' || action === 'back' || action === 'exit' || action === 'quit') {
      console.log(pc.green('✔ Exited session dashboard.\n'));
      break;
    }

    const index = parseInt(targetIdxStr, 10) - 1;
    if (isNaN(index) || index < 0 || index >= sessions.length) {
      if (['l', 'load', 'f', 'fetch', 'd', 'delete'].includes(action)) {
        console.log(pc.red('❌ Error: Invalid session number. Please specify a valid number from the list.\n'));
        continue;
      }
      console.log(pc.red(`❌ Error: Unknown action or invalid input: "${trimmed}".\n`));
      continue;
    }

    const selectedSession = sessions[index];

    if (action === 'l' || action === 'load') {
      console.log(pc.green(`✔ Loaded session: ${pc.bold(selectedSession.id)}`));
      return { action: 'load', sessionId: selectedSession.id };
    } 
    
    else if (action === 'f' || action === 'fetch') {
      const fullSession = await sessionServiceInstance.getSession({
        appName: 'plumar-cli',
        userId: 'default-user',
        sessionId: selectedSession.id
      });

      if (!fullSession || !fullSession.events || fullSession.events.length === 0) {
        console.log(pc.yellow('\n📭 This session has no messages or history events yet.\n'));
      } else {
        console.log(pc.bold(pc.yellow(`\n💬 Conversation History for Session: ${selectedSession.id}`)));
        console.log(pc.dim('─'.repeat(60)));
        
        for (const event of fullSession.events) {
          // Identify speaker
          let speaker = pc.green(pc.bold('You'));
          if (event.role === 'model') {
            speaker = pc.magenta(pc.bold('🤖 Assistant'));
          } else if (event.role === 'system') {
            speaker = pc.yellow(pc.bold('⚙️ System'));
          } else if (event.type === 'tool_call' || (event.parts && event.parts.some(p => p.functionCall))) {
            speaker = pc.cyan(pc.bold('🛠️ Agent Tool Call'));
          } else if (event.type === 'tool_result' || (event.parts && event.parts.some(p => p.functionResponse))) {
            speaker = pc.blue(pc.bold('📦 Agent Tool Result'));
          }

          let text = '';
          if (event.parts) {
            for (const part of event.parts) {
              if (part.text) {
                text += part.text;
              } else if (part.functionCall) {
                text += `Calling tool: ${part.functionCall.name} with args: ${JSON.stringify(part.functionCall.args)}`;
              } else if (part.functionResponse) {
                text += `Result from tool ${part.functionResponse.name}: ${JSON.stringify(part.functionResponse.response)}`;
              }
            }
          } else if (event.content) {
            text = typeof event.content === 'string' ? event.content : JSON.stringify(event.content);
          }

          if (text.trim()) {
            console.log(`${speaker}:\n${text.trim()}\n`);
          }
        }
        console.log(pc.dim('─'.repeat(60)));
        console.log();
      }
      
      await rl.question(pc.cyan('Press [Enter] to return to the dashboard list › '));
      console.clear();
    } 
    
    else if (action === 'd' || action === 'delete') {
      const confirm = await rl.question(pc.red(`⚠️  Are you sure you want to delete session ${pc.bold(selectedSession.id)}? [y/N] › `));
      if (confirm.toLowerCase().startsWith('y')) {
        await sessionServiceInstance.deleteSession({
          appName: 'plumar-cli',
          userId: 'default-user',
          sessionId: selectedSession.id
        });
        console.log(pc.green(`✔ Session ${pc.bold(selectedSession.id)} successfully deleted.\n`));
        
        if (selectedSession.id === activeSessionId) {
          console.log(pc.yellow('💡 Note: You deleted your currently active session. Switching to a new clean session...\n'));
          return { action: 'deleted_active' };
        }
      } else {
        console.log(pc.yellow('Deletion cancelled.\n'));
      }
    } 
    
    else {
      console.log(pc.red(`❌ Error: Unknown action: "${action}".\n`));
    }
  }

  return { action: 'none' };
}
