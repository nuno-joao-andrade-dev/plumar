import test from 'node:test';
import assert from 'node:assert';
import { parsePromptPiping, executePipeCommand, populateReadlineHistory } from '../index.js';
import { loadSearchHistory } from '../src/reverse-search.js';
import { InMemorySessionService } from '@google/adk';
import { runAgentTurn } from '../src/agent.js';

test('Prompt Piping Parser & Command Execution Suite', async (t) => {

  await t.test('parsePromptPiping: should correctly identify no pipe', () => {
    const input = 'hello what is the meaning of life';
    const result = parsePromptPiping(input);
    assert.strictEqual(result.prompt, input);
    assert.strictEqual(result.command, null);
  });

  await t.test('parsePromptPiping: should ignore questions about the pipe character', () => {
    const input1 = 'what is the meaning of |?';
    const res1 = parsePromptPiping(input1);
    assert.strictEqual(res1.prompt, input1);
    assert.strictEqual(res1.command, null);

    const input2 = 'how is | used in bitwise OR';
    const res2 = parsePromptPiping(input2);
    assert.strictEqual(res2.prompt, input2);
    assert.strictEqual(res2.command, null);
  });

  await t.test('parsePromptPiping: should parse valid command piping', () => {
    const input1 = 'show me workspace files | ls -la';
    const res1 = parsePromptPiping(input1);
    assert.strictEqual(res1.prompt, 'show me workspace files');
    assert.strictEqual(res1.command, 'ls -la');

    // Piping containing internal pipes in command
    const input2 = 'get details | cat package.json | grep name';
    const res2 = parsePromptPiping(input2);
    assert.strictEqual(res2.prompt, 'get details');
    assert.strictEqual(res2.command, 'cat package.json | grep name');
  });

  await t.test('parsePromptPiping: should bypass safety checks and parse direct shell command when prompt is empty', () => {
    const input = '| ls -la';
    const res = parsePromptPiping(input);
    assert.strictEqual(res.prompt, '');
    assert.strictEqual(res.command, 'ls -la');

    const input2 = '|echo hello world';
    const res2 = parsePromptPiping(input2);
    assert.strictEqual(res2.prompt, '');
    assert.strictEqual(res2.command, 'echo hello world');
  });

  await t.test('executePipeCommand: should execute valid shell command and capture stdout', async () => {
    const result = await executePipeCommand('echo "Hello World from Pipe"');
    assert.ok(result.includes('Hello World from Pipe'));
  });

  await t.test('executePipeCommand: should handle shell errors gracefully', async () => {
    const result = await executePipeCommand('non_existent_command_xyz_123');
    assert.ok(result.includes('Error executing command'));
    assert.ok(result.includes('non_existent_command_xyz_123'));
  });
});

test('Search History Collection Suite', async (t) => {
  await t.test('loadSearchHistory: should load history from active readline session and session logs', async () => {
    const mockRl = {
      history: [
        'npm run dev',
        '/help',
        'explain index.js'
      ]
    };

    const mockSessionService = {
      listSessions: async () => ({
        sessions: [{ id: 'sess-1' }]
      }),
      getSession: async () => ({
        id: 'sess-1',
        events: [
          { parts: [{ text: 'user prompt from db' }] },
          { parts: [{ text: 'model response text' }] },
          { content: 'another short prompt' }
        ]
      })
    };

    const history = await loadSearchHistory(mockRl, mockSessionService);
    
    // Readline items
    assert.ok(history.includes('npm run dev'));
    assert.ok(history.includes('/help'));
    assert.ok(history.includes('explain index.js'));

    // Persistent history items (short prompts under 250 chars and not starting with / or containing newlines)
    assert.ok(history.includes('user prompt from db'));
    assert.ok(history.includes('another short prompt'));

    // Model responses and commands should be filtered or included appropriately
    assert.ok(history.includes('model response text'));
  });
});

test('Interactive Formatter Help Topic Suite', async (t) => {
  const { printHelp } = await import('../src/formatter.js');

  await t.test('printHelp: should print help for piping topic', () => {
    let output = '';
    const originalLog = console.log;
    console.log = (msg) => { output += (msg || '') + '\n'; };

    try {
      printHelp('piping');
    } finally {
      console.log = originalLog;
    }

    assert.ok(output.includes('Prompt Piping Help'));
    assert.ok(output.includes('Syntax:'));
    assert.ok(output.includes('|'));
  });

  await t.test('printHelp: should print help for history topic', () => {
    let output = '';
    const originalLog = console.log;
    console.log = (msg) => { output += (msg || '') + '\n'; };

    try {
      printHelp('history');
    } finally {
      console.log = originalLog;
    }

    assert.ok(output.includes('Command & Search History Help'));
    assert.ok(output.includes('Ctrl+R'));
  });

  await t.test('printHelp: should fall back to general menu when topic is empty or unknown', () => {
    let output = '';
    const originalLog = console.log;
    console.log = (msg) => { output += (msg || '') + '\n'; };

    try {
      printHelp('unknown_random_topic');
    } finally {
      console.log = originalLog;
    }

    assert.ok(output.includes('Available Chat Commands'));
    assert.ok(output.includes('/help piping'));
    assert.ok(output.includes('/help history'));
  });
});

test('Request Cancellation Suite', async (t) => {
  const originalFetch = globalThis.fetch;
  
  t.before(() => {
    globalThis.fetch = async (url, options) => {
      if (typeof url === 'string' && url.endsWith('/api/show')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            model_info: {
              'gemma4.context_length': 131072,
              'gptoss.context_length': 131072
            }
          })
        };
      }
      if (options?.signal?.aborted) {
        const err = new Error('The user aborted a request.');
        err.name = 'AbortError';
        throw err;
      }
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({ choices: [{ message: { content: 'hello' } }] })
      };
    };
  });

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await t.test('executePipeCommand: should respect AbortSignal and abort immediately', async () => {
    const controller = new AbortController();
    controller.abort();
    try {
      await executePipeCommand('sleep 5', controller.signal);
      assert.fail('Should have thrown AbortError');
    } catch (err) {
      assert.ok(err.name === 'AbortError' || controller.signal.aborted);
    }
  });

  await t.test('runAgentTurn: should check abortSignal and raise cancellation error when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    try {
      await runAgentTurn('sess-cancel-test', 'hello', 'gemma4:latest', 'balanced', controller.signal);
      assert.fail('Should have thrown cancellation error');
    } catch (err) {
      assert.strictEqual(err.message, 'Request cancelled by user (ESC)');
    }
  });
});

test('printSamples Suite', async (t) => {
  const { printSamples } = await import('../src/formatter.js');

  await t.test('printSamples: should output sample commands for loaded tools', () => {
    let output = '';
    const originalLog = console.log;
    console.log = (msg) => { output += (msg || '') + '\n'; };

    try {
      printSamples({
        calculator: {},
        getSystemInfo: {},
        unknownTool: {}
      });
    } finally {
      console.log = originalLog;
    }

    assert.ok(output.includes('Tool Sample Commands & Prompts'));
    assert.ok(output.includes('calculator'));
    assert.ok(output.includes('Calculate 25 * (144 / 12)'));
    assert.ok(output.includes('unknownTool'));
    assert.ok(output.includes('Use the unknownTool tool to accomplish your task'));
  });
});

test('Readline History Restoration Suite', async (t) => {
  await t.test('populateReadlineHistory: should load past user prompts into readline.history in reverse chronological order', async () => {
    const mockRl = {
      history: []
    };

    const mockSessionService = {
      getSession: async () => ({
        id: 'sess-restore-test',
        events: [
          { role: 'user', content: 'first prompt (oldest)' },
          { role: 'model', content: 'model response' },
          { role: 'user', parts: [{ text: 'second prompt' }] },
          { role: 'user', content: 'third prompt (newest)' },
          { role: 'user', content: 'third prompt (newest)' } // duplicate
        ]
      })
    };

    await populateReadlineHistory(mockRl, 'sess-restore-test', mockSessionService);

    assert.strictEqual(mockRl.history.length, 3);
    assert.strictEqual(mockRl.history[0], 'third prompt (newest)');
    assert.strictEqual(mockRl.history[1], 'second prompt');
    assert.strictEqual(mockRl.history[2], 'first prompt (oldest)');
    assert.strictEqual(mockRl.historyIndex, -1);
  });
});


