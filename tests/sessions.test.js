import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import { PersistentFileSessionService } from '../src/session-manager.js';

describe('PersistentFileSessionService Suite', () => {
  const testStorageDir = path.join(process.cwd(), 'tests', 'temp_sessions_test');

  before(async () => {
    // Ensure test directory is clean
    await fs.mkdir(testStorageDir, { recursive: true });
  });

  after(async () => {
    // Cleanup test directory
    try {
      await fs.rm(testStorageDir, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  test('should persistently write session files to disk on creation and update', async () => {
    const service = new PersistentFileSessionService(testStorageDir);
    const sessionId = 'test-session-persistent-1';

    // 1. Create session
    const session = await service.createSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId
    });

    assert.ok(session);
    assert.strictEqual(session.id, sessionId);

    // Verify file exists on disk
    const expectedFileName = 'plumar-cli-default-user-test-session-persistent-1.json';
    const filePath = path.join(testStorageDir, expectedFileName);
    const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
    assert.ok(fileExists, 'Session JSON file should exist on disk after creation');

    // Verify file content is valid JSON
    const content = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(content);
    assert.strictEqual(parsed.id, sessionId);
    assert.strictEqual(parsed.events.length, 0);

    // 2. Append event
    await service.appendEvent({
      session,
      event: { role: 'user', timestamp: Date.now(), content: 'Hello persistence' }
    });

    // Verify file content has been updated
    const updatedContent = await fs.readFile(filePath, 'utf8');
    const updatedParsed = JSON.parse(updatedContent);
    assert.strictEqual(updatedParsed.events.length, 1);
    assert.strictEqual(updatedParsed.events[0].content, 'Hello persistence');

    // 3. Delete session
    await service.deleteSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId
    });

    // Verify file is gone from disk
    const fileExistsAfterDelete = await fs.access(filePath).then(() => true).catch(() => false);
    assert.strictEqual(fileExistsAfterDelete, false, 'Session JSON file should be removed from disk');
  });

  test('should load existing session files from disk on initialization', async () => {
    const initialService = new PersistentFileSessionService(testStorageDir);
    const sessionId = 'test-load-init-1';

    // Create session to persist it
    await initialService.createSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId
    });

    // Instantiate a totally new session service pointing to the same folder
    const loadedService = new PersistentFileSessionService(testStorageDir);
    
    // Call init to load from files
    await loadedService.init();

    // Verify it exists in cache
    const retrieved = await loadedService.getSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId
    });

    assert.ok(retrieved, 'Session should be loaded from disk during init()');
    assert.strictEqual(retrieved.id, sessionId);

    // Clean up
    await loadedService.deleteSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId
    });
  });

  test('should list saved sessions in desc/asc order of updates', async () => {
    const service = new PersistentFileSessionService(testStorageDir);
    
    await service.createSession({ appName: 'plumar-cli', userId: 'default-user', sessionId: 'list-1' });
    await new Promise(resolve => setTimeout(resolve, 50));
    await service.createSession({ appName: 'plumar-cli', userId: 'default-user', sessionId: 'list-2' });

    const listResult = await service.listSessions({
      appName: 'plumar-cli',
      userId: 'default-user',
      order: 'desc'
    });

    assert.ok(listResult.sessions.length >= 2);
    // Descending order means last created/updated is first
    assert.strictEqual(listResult.sessions[0].id, 'list-2');
    assert.strictEqual(listResult.sessions[1].id, 'list-1');

    // Clean up
    await service.deleteSession({ appName: 'plumar-cli', userId: 'default-user', sessionId: 'list-1' });
    await service.deleteSession({ appName: 'plumar-cli', userId: 'default-user', sessionId: 'list-2' });
  });

  test('should support session context minimization by slicing events and persisting', async () => {
    const service = new PersistentFileSessionService(testStorageDir);
    const sessionId = 'test-minimize-session-1';

    // 1. Create session
    const session = await service.createSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId
    });

    // 2. Append more than 10 events (e.g. 15 events)
    for (let i = 1; i <= 15; i++) {
      await service.appendEvent({
        session,
        event: { role: 'user', timestamp: Date.now() + i, content: `Event number ${i}` }
      });
    }

    // Retrieve to verify 15 events exist in-memory/on-disk
    const retrieved = await service.getSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId
    });
    assert.strictEqual(retrieved.events.length, 15);

    // 3. Minimize events by slicing to last 10 using minimizeSession
    const minimizeResult = await service.minimizeSession('plumar-cli', 'default-user', sessionId, 10);
    assert.ok(minimizeResult);
    assert.strictEqual(minimizeResult.success, true);
    assert.strictEqual(minimizeResult.initialCount, 15);
    assert.strictEqual(minimizeResult.finalCount, 10);

    // 4. Instantiate a completely new session service to reload from disk and check persistence
    const reloadedService = new PersistentFileSessionService(testStorageDir);
    await reloadedService.init();

    const loadedSession = await reloadedService.getSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId
    });

    assert.ok(loadedSession);
    assert.strictEqual(loadedSession.events.length, 10);
    assert.strictEqual(loadedSession.events[0].content, 'Event number 6');
    assert.strictEqual(loadedSession.events[9].content, 'Event number 15');

    // Clean up
    await reloadedService.deleteSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId
    });
  });

  test('should correctly identify session size threshold (256 KB)', async () => {
    const service = new PersistentFileSessionService(testStorageDir);
    const sessionId = 'test-large-session-1';

    // Create session
    const session = await service.createSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId
    });

    // Append standard small event
    await service.appendEvent({
      session,
      event: { role: 'user', timestamp: Date.now(), content: 'Small query' }
    });

    let retrieved = await service.getSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId
    });
    let sizeKb = Buffer.byteLength(JSON.stringify(retrieved.events), 'utf8') / 1024;
    assert.ok(sizeKb < 256, 'Fresh session should be well under 256 KB');

    // Append a very large event of 300 KB content
    const largePayload = 'a'.repeat(300 * 1024);
    await service.appendEvent({
      session,
      event: { role: 'model', timestamp: Date.now() + 10, content: largePayload }
    });

    retrieved = await service.getSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId
    });
    sizeKb = Buffer.byteLength(JSON.stringify(retrieved.events), 'utf8') / 1024;
    assert.ok(sizeKb > 256, 'Large session should exceed 256 KB');

    // Clean up
    await service.deleteSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId
    });
  });

  test('should recursively scan current folder and embed a minimized index of local files into active context', async () => {
    const service = new PersistentFileSessionService(testStorageDir);
    const sessionId = 'test-context-folder-1';

    // 1. Create session
    const session = await service.createSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId
    });

    // 2. Scan current workspace (which is process.cwd())
    const ignoreDirs = ['node_modules', '.git', '.antigravitycli', '.gemini', 'package-lock.json', '.DS_Store'];

    const buildTree = async (dirPath, relativePrefix = '') => {
      let fileList = [];
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (ignoreDirs.includes(entry.name)) continue;

        const relativePath = path.join(relativePrefix, entry.name);
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          try {
            const subFiles = await buildTree(fullPath, relativePath);
            fileList = fileList.concat(subFiles);
          } catch (e) {}
        } else {
          try {
            const stats = await fs.stat(fullPath);
            const sizeKb = (stats.size / 1024).toFixed(1);
            fileList.push({ path: relativePath, sizeKb });
          } catch (e) {}
        }
      }
      return fileList;
    };

    const files = await buildTree(process.cwd());
    assert.ok(files.length > 0, 'Workspace should contain some files');

    // Build compact representation
    const fileLines = files.map(f => `- ${f.path} (${f.sizeKb} KB)`).join('\n');
    const contextMsg = `[Workspace Local Files Context]\nBelow is the directory tree of the current project workspace containing all local files that are available:\n\n${fileLines}`;

    // Append to context
    await service.appendEvent({
      session,
      event: {
        role: 'user',
        timestamp: Date.now(),
        content: contextMsg
      }
    });

    // 3. Reload session from disk and verify the folder context exists
    const reloadedService = new PersistentFileSessionService(testStorageDir);
    await reloadedService.init();

    const loadedSession = await reloadedService.getSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId
    });

    assert.ok(loadedSession);
    assert.strictEqual(loadedSession.events.length, 1);
    const content = loadedSession.events[0].content;
    assert.ok(content.includes('[Workspace Local Files Context]'));
    assert.ok(content.includes('index.js'));
    assert.ok(content.includes('package.json'));

    // Clean up
    await reloadedService.deleteSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId
    });
  });

  test('should ask the model to summarize older events when modelName is provided and fetch is successful', async () => {
    const service = new PersistentFileSessionService(testStorageDir);
    const sessionId = 'test-model-minimize-1';

    // Create session
    const session = await service.createSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId
    });

    // Append 12 events (so we exceed targetKeep of 10)
    // Make some older events exceed 1024 characters so they are minimized
    for (let i = 1; i <= 12; i++) {
      const isOlderAndLarge = i <= 2;
      await service.appendEvent({
        session,
        event: {
          role: i % 2 === 1 ? 'user' : 'model',
          timestamp: Date.now() + i,
          content: isOlderAndLarge 
            ? `Message number ${i} which is quite large. ` + 'a'.repeat(2000)
            : `Message number ${i}`
        }
      });
    }

    // Mock global fetch to return a mock summarization
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      return {
        ok: true,
        json: async () => ({
          message: {
            role: 'assistant',
            content: 'Summary: Compressed dialogue history.'
          }
        })
      };
    };

    try {
      const res = await service.minimizeSession('plumar-cli', 'default-user', sessionId, 10, 'mock-model');
      assert.ok(res.success);
      assert.strictEqual(res.summarized, true);
      assert.strictEqual(res.finalCount, 12); // Count remains exactly 12!

      const loaded = await service.getSession({
        appName: 'plumar-cli',
        userId: 'default-user',
        sessionId
      });

      // The older events (e.g., index 0 and 1) should contain the summarized/minimized content
      assert.strictEqual(loaded.events[0].content, 'Summary: Compressed dialogue history.');
      assert.strictEqual(loaded.events[1].content, 'Summary: Compressed dialogue history.');
      // The recent events (last 10 events) should be kept completely intact as original content
      assert.strictEqual(loaded.events[2].content, 'Message number 3');
      assert.strictEqual(loaded.events[11].content, 'Message number 12');
    } finally {
      // Restore original fetch
      global.fetch = originalFetch;

      // Clean up
      await service.deleteSession({
        appName: 'plumar-cli',
        userId: 'default-user',
        sessionId
      });
    }
  });

  test('should dynamically minimize session with count <= 10 if session size exceeds 256 KB', async () => {
    const service = new PersistentFileSessionService(testStorageDir);
    const sessionId = 'test-model-large-size-1';

    // Create session
    const session = await service.createSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId
    });

    // Append 2 events
    for (let i = 1; i <= 2; i++) {
      await service.appendEvent({
        session,
        event: {
          role: 'user',
          timestamp: Date.now() + i,
          content: `Message ${i}`
        }
      });
    }

    // Append 1 massive event (bringing size > 256KB)
    await service.appendEvent({
      session,
      event: {
        role: 'user',
        timestamp: Date.now() + 3,
        content: 'a'.repeat(300 * 1024)
      }
    });

    // Append 2 recent events (which will be kept fully intact)
    for (let i = 4; i <= 5; i++) {
      await service.appendEvent({
        session,
        event: {
          role: 'user',
          timestamp: Date.now() + i,
          content: `Message ${i}`
        }
      });
    }

    // Mock global fetch to return a mock summarization
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      return {
        ok: true,
        json: async () => ({
          message: {
            role: 'assistant',
            content: 'Summary: Compressed large files list.'
          }
        })
      };
    };

    try {
      const res = await service.minimizeSession('plumar-cli', 'default-user', sessionId, 10, 'mock-model');
      assert.ok(res.success);
      assert.strictEqual(res.summarized, true);
      // It should keep activeKeep = 2, and summarize first 3 events (5 total events).
      // Total count remains 5 because we do not remove any events from history!
      assert.strictEqual(res.finalCount, 5);

      const loaded = await service.getSession({
        appName: 'plumar-cli',
        userId: 'default-user',
        sessionId
      });

      // The large event (index 2) was older (prior to last 2 events), so it got minimized in-place.
      assert.strictEqual(loaded.events[2].content, 'Summary: Compressed large files list.');
      // The last 2 recent events remain intact.
      assert.strictEqual(loaded.events[3].content, 'Message 4');
      assert.strictEqual(loaded.events[4].content, 'Message 5');
    } finally {
      global.fetch = originalFetch;

      await service.deleteSession({
        appName: 'plumar-cli',
        userId: 'default-user',
        sessionId
      });
    }
  });

  test('should chunk a massive single event into multiple portions and synthesize them successfully when context is > 256 KB', async () => {
    const service = new PersistentFileSessionService(testStorageDir);
    const sessionId = 'test-model-massive-portions-1';

    // 1. Create session
    const session = await service.createSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId
    });

    // 2. Append a massive single event (e.g., 250,000 characters of 'a\n' to ensure many lines)
    const massiveContent = Array(125000).fill('a').join('\n'); // 250,000 characters, ~250 KB
    await service.appendEvent({
      session,
      event: { role: 'user', timestamp: Date.now() + 1, content: massiveContent }
    });

    // Append 2 recent events (so they are kept as active context)
    await service.appendEvent({
      session,
      event: { role: 'user', timestamp: Date.now() + 2, content: 'Recent Message 1' }
    });
    await service.appendEvent({
      session,
      event: { role: 'model', timestamp: Date.now() + 3, content: 'Recent Message 2' }
    });

    const fetchUrls = [];
    const fetchPayloads = [];

    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      fetchUrls.push(url);
      const body = JSON.parse(options.body);
      fetchPayloads.push(body);

      // Check if it's synthesis or individual portion
      const isSynthesis = body.messages[0].content.includes('Below are several summaries') || body.messages[0].content.includes('synthesize');
      return {
        ok: true,
        json: async () => ({
          message: {
            role: 'assistant',
            content: isSynthesis 
              ? 'Final Unified Synthesis: Cleaned and summarized complete massive logs.'
              : `Portion Summary Mock ${fetchUrls.length}`
          }
        })
      };
    };

    try {
      const res = await service.minimizeSession('plumar-cli', 'default-user', sessionId, 10, 'mock-model');
      assert.ok(res.success);
      assert.strictEqual(res.summarized, true);

      // With MAX_PORTION_CHARS = 100,000, 250,000 chars should be split into 3 portions:
      // Portion 1 (100,000 chars), Portion 2 (100,000 chars), Portion 3 (50,000 chars)
      // So fetch should be called 3 times for portions, plus 1 time for synthesizing those 3 summaries.
      // Total fetch calls = 4.
      assert.strictEqual(fetchUrls.length, 4, 'Should call fetch 4 times (3 portion summaries + 1 final synthesis)');

      const loaded = await service.getSession({
        appName: 'plumar-cli',
        userId: 'default-user',
        sessionId
      });

      assert.strictEqual(loaded.events.length, 3); // Kept exactly 3 events!
      assert.strictEqual(loaded.events[0].content, 'Final Unified Synthesis: Cleaned and summarized complete massive logs.');
      assert.strictEqual(loaded.events[1].content, 'Recent Message 1');
      assert.strictEqual(loaded.events[2].content, 'Recent Message 2');
    } finally {
      global.fetch = originalFetch;

      await service.deleteSession({
        appName: 'plumar-cli',
        userId: 'default-user',
        sessionId
      });
    }
  });

  test('should support parts-based event content minimization and update parts array in-place', async () => {
    const service = new PersistentFileSessionService(testStorageDir);
    const sessionId = 'test-parts-minimization';

    const session = await service.createSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId
    });

    // Append 1 older event with parts
    await service.appendEvent({
      session,
      event: {
        role: 'user',
        parts: [{ text: 'a'.repeat(2000) }]
      }
    });

    // Append 2 recent events to satisfy activeKeep = 2
    await service.appendEvent({
      session,
      event: { role: 'user', content: 'Recent 1' }
    });
    await service.appendEvent({
      session,
      event: { role: 'model', content: 'Recent 2' }
    });

    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        message: {
          role: 'assistant',
          content: 'Summary: Compacted Parts.'
        }
      })
    });

    try {
      const res = await service.minimizeSession('plumar-cli', 'default-user', sessionId, 2, 'mock-model');
      assert.ok(res.success);
      assert.strictEqual(res.summarized, true);

      const loaded = await service.getSession({
        appName: 'plumar-cli',
        userId: 'default-user',
        sessionId
      });

      assert.strictEqual(loaded.events.length, 3);
      assert.ok(loaded.events[0].parts);
      assert.strictEqual(loaded.events[0].parts[0].text, 'Summary: Compacted Parts.');
    } finally {
      global.fetch = originalFetch;
      await service.deleteSession({ appName: 'plumar-cli', userId: 'default-user', sessionId });
    }
  });

  test('should fallback to local heuristic truncation if model minimization fails/throws', async () => {
    const service = new PersistentFileSessionService(testStorageDir);
    const sessionId = 'test-heuristic-fallback';

    const session = await service.createSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId
    });

    // Append 1 older large event
    await service.appendEvent({
      session,
      event: {
        role: 'user',
        content: 'a'.repeat(2000)
      }
    });

    // Append 2 recent events
    await service.appendEvent({
      session,
      event: { role: 'user', content: 'Recent 1' }
    });
    await service.appendEvent({
      session,
      event: { role: 'model', content: 'Recent 2' }
    });

    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error('Ollama offline');
    };

    try {
      const res = await service.minimizeSession('plumar-cli', 'default-user', sessionId, 2, 'mock-model');
      assert.ok(res.success);
      assert.strictEqual(res.summarized, true);

      const loaded = await service.getSession({
        appName: 'plumar-cli',
        userId: 'default-user',
        sessionId
      });

      assert.strictEqual(loaded.events.length, 3);
      assert.ok(loaded.events[0].content.includes('Heuristically truncated'));
    } finally {
      global.fetch = originalFetch;
      await service.deleteSession({ appName: 'plumar-cli', userId: 'default-user', sessionId });
    }
  });

  test('should strip massive raw outputs from older tool results while preserving dialogue history', async () => {
    const service = new PersistentFileSessionService(testStorageDir);
    const sessionId = 'test-tool-result-stripping';

    const session = await service.createSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId
    });

    // 1. Append a user message
    await service.appendEvent({
      session,
      event: { role: 'user', content: 'Scan the codebase' }
    });

    // 2. Append a tool result event with a massive raw payload
    await service.appendEvent({
      session,
      event: {
        role: 'tool',
        type: 'tool_result',
        parts: [
          {
            functionResponse: {
              name: 'readFile',
              response: {
                success: true,
                filePath: 'big-source.js',
                content: 'a'.repeat(5000) // 5 KB payload
              }
            }
          }
        ]
      }
    });

    // 3. Append a more recent conversational turn (to make the previous tool result "old")
    await service.appendEvent({
      session,
      event: { role: 'user', content: 'How large is it?' }
    });
    await service.appendEvent({
      session,
      event: { role: 'model', content: 'It is 5KB.' }
    });

    try {
      const res = await service.minimizeSession('plumar-cli', 'default-user', sessionId, 10);
      assert.ok(res.success);
      assert.strictEqual(res.toolResultsStripped, true);

      const loaded = await service.getSession({
        appName: 'plumar-cli',
        userId: 'default-user',
        sessionId
      });

      // Verification
      assert.strictEqual(loaded.events.length, 4);
      
      // The tool result event (index 1) should be stripped
      const strippedPart = loaded.events[1].parts[0].functionResponse;
      assert.strictEqual(strippedPart.response._omitted, true);
      assert.strictEqual(strippedPart.response.filePath, 'big-source.js');
      assert.ok(strippedPart.response.message.includes('omitted to save space'));
      
      // The recent dialogue turns (indices 2 and 3) must be kept 100% intact
      assert.strictEqual(loaded.events[2].content, 'How large is it?');
      assert.strictEqual(loaded.events[3].content, 'It is 5KB.');
    } finally {
      await service.deleteSession({ appName: 'plumar-cli', userId: 'default-user', sessionId });
    }
  });

  test('should fall back to structural slicing when modelName is provided but no events are large enough for in-place compression', async () => {
    const service = new PersistentFileSessionService(testStorageDir);
    const sessionId = 'test-fallback-slicing';

    const session = await service.createSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId
    });

    // 12 small events
    for (let i = 1; i <= 12; i++) {
      await service.appendEvent({
        session,
        event: { role: 'user', content: `Small message ${i}` }
      });
    }

    try {
      // targetKeep = 10, with modelName provided
      const res = await service.minimizeSession('plumar-cli', 'default-user', sessionId, 10, 'mock-model');
      assert.ok(res.success);
      assert.strictEqual(res.summarized, false); // No model summarization took place

      const loaded = await service.getSession({
        appName: 'plumar-cli',
        userId: 'default-user',
        sessionId
      });

      // Verification: should fall back to structural slicing and keep exactly last 10 events
      assert.strictEqual(loaded.events.length, 10);
      assert.strictEqual(loaded.events[0].content, 'Small message 3');
      assert.strictEqual(loaded.events[9].content, 'Small message 12');
    } finally {
      await service.deleteSession({ appName: 'plumar-cli', userId: 'default-user', sessionId });
    }
  });
});

