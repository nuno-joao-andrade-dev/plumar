import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { runAgentTurn, fetchOllamaModels, sessionService, getOllamaBaseUrl, setOllamaBaseUrl, registerMcpTools, tools, isVerboseJsonEnabled, setVerboseJsonEnabled, isAdkInfoEnabled, setAdkInfoEnabled, setDefaultPolicy, setToolPolicy, getToolPolicy, getAllToolPolicies, loadPolicyConfig, savePolicyConfig, getActivePolicyConfigFile, setActivePolicyConfigFile, getDefaultPolicy, getSessionTokens, resetSessionTokens } from '../src/agent.js';

test('Agent Integration Suite (Real-World Use Cases)', async (t) => {
  const originalFetch = globalThis.fetch;
  let mockFetchResponses = [];

  // Override fetch globally for isolation and offline capability during testing
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
      const responseConfig = mockFetchResponses.shift();
      if (!responseConfig) {
        throw new Error(`No mock fetch response configured for URL: ${url}`);
      }
      return {
        ok: responseConfig.ok ?? true,
        status: responseConfig.status ?? 200,
        statusText: responseConfig.statusText ?? 'OK',
        text: async () => responseConfig.text ?? '',
        json: async () => responseConfig.json ?? {},
      };
    };
  });

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  t.beforeEach(() => {
    mockFetchResponses = [];
  });

  await t.test('Use Case 1: fetchOllamaModels should parse active local models list', async () => {
    mockFetchResponses.push({
      json: {
        models: [
          { name: 'gemma4:latest' },
          { name: 'codegemma:latest' }
        ]
      }
    });

    const list = await fetchOllamaModels();
    assert.deepStrictEqual(list, ['gemma4:latest', 'codegemma:latest']);
  });

  await t.test('Use Case 2: Standard user message should parse thinking and return text response', async () => {
    const sessionId = 'test-usecase-2';
    
    // Configure the mock response from local Ollama API
    mockFetchResponses.push({
      json: {
        choices: [{
          message: {
            role: 'assistant',
            content: '<thinking>The user said hi. I will greet them back.</thinking>Hello! How can I help you today?'
          }
        }]
      }
    });

    const res = await runAgentTurn(sessionId, 'hi', 'gemma4:latest', 'balanced');
    
    // Assert response text is extracted correctly (thinking process block removed)
    assert.deepStrictEqual(res.text, 'Hello! How can I help you today?');
    
    // Assert thinking step was parsed and extracted as a thought event
    assert.strictEqual(res.steps.length, 1);
    assert.strictEqual(res.steps[0].type, 'thought');
    assert.strictEqual(res.steps[0].content.parts[0].text, 'The user said hi. I will greet them back.');
    assert.strictEqual(res.steps[0].content.parts[0].thought, true);

    // Verify session contains user message and agent response events
    const session = await sessionService.getSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId
    });
    assert.ok(session);
    assert.ok(session.events.length >= 2);
  });

  await t.test('Use Case 3: Complex multi-turn turn with tool calls and planning', async () => {
    const sessionId = 'test-usecase-3';

    // 1. First fetch response: model requests a tool call to calculate expression
    mockFetchResponses.push({
      json: {
        choices: [{
          message: {
            role: 'assistant',
            content: '<thinking>I need to calculate 25 * 4 to answer the user.</thinking>',
            tool_calls: [{
              id: 'call_calculator_1',
              type: 'function',
              function: {
                name: 'calculator',
                arguments: JSON.stringify({ expression: '25 * 4' })
              }
            }]
          }
        }]
      }
    });

    // 2. Second fetch response (after tools.calculator tool runs and returns its result to model)
    mockFetchResponses.push({
      json: {
        choices: [{
          message: {
            role: 'assistant',
            content: 'The calculation results in 100.'
          }
        }]
      }
    });

    const res = await runAgentTurn(sessionId, 'What is 25 * 4?', 'gemma4:latest', 'balanced');

    // Assert final text output
    assert.deepStrictEqual(res.text, 'The calculation results in 100.');

    // Assert the first thinking process was captured as a thought event
    assert.ok(res.steps.length >= 1);
    const hasThought = res.steps.some(s => s.content?.parts?.some(p => p.thought && p.text.includes('25 * 4')));
    assert.ok(hasThought);

    // Assert the session is updated correctly
    const session = await sessionService.getSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId
    });
    assert.ok(session);

    // Verify that the tool call and tool response are recorded in the session events
    const eventTypes = session.events.map(e => e.type);
    assert.ok(eventTypes.includes('tool_call'));
    assert.ok(eventTypes.includes('tool_result'));
  });

  await t.test('Use Case 4: Ollama dynamic URL resolution and fallback behavior', async () => {
    const originalEnv = process.env.OLLAMA_HOST;
    try {
      // Test default local fallback
      delete process.env.OLLAMA_HOST;
      assert.strictEqual(getOllamaBaseUrl(), 'http://localhost:11434');

      // Test with custom env variable without protocol prefix
      process.env.OLLAMA_HOST = '10.0.0.5:11434/';
      assert.strictEqual(getOllamaBaseUrl(), 'http://10.0.0.5:11434');

      // Test setOllamaBaseUrl explicitly
      setOllamaBaseUrl('https://remote-ollama-server.com:443/');
      assert.strictEqual(getOllamaBaseUrl(), 'https://remote-ollama-server.com:443');
    } finally {
      process.env.OLLAMA_HOST = originalEnv;
    }
  });

  await t.test('Use Case 5: End-to-end chat mode switching and session isolated context', async () => {
    const sessionId = 'test-usecase-5-isolated';
    
    // Clean up from prior runs to ensure fresh test state
    try {
      await sessionService.deleteSession({
        appName: 'plumar-cli',
        userId: 'default-user',
        sessionId
      });
    } catch (e) {
      // ignore
    }
    
    // Greeting in balanced mode
    mockFetchResponses.push({
      json: {
        choices: [{
          message: {
            role: 'assistant',
            content: 'Hello, I am Balanced.'
          }
        }]
      }
    });

    const res1 = await runAgentTurn(sessionId, 'hi', 'gemma4:latest', 'balanced');
    assert.strictEqual(res1.text, 'Hello, I am Balanced.');

    // Code execution in code mode (should have expert programmer instruction)
    mockFetchResponses.push({
      json: {
        choices: [{
          message: {
            role: 'assistant',
            content: 'Here is some beautiful code.'
          }
        }]
      }
    });

    const res2 = await runAgentTurn(sessionId, 'write a script', 'gemma4:latest', 'code');
    assert.strictEqual(res2.text, 'Here is some beautiful code.');

    // Verify both events reside sequentially in the same session
    const session = await sessionService.getSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId
    });
    assert.ok(session);
    // User message 1, model 1, user message 2, model 2
    assert.strictEqual(session.events.length, 4);
  });

  await t.test('Use Case 6: Dynamic MCP tools registration and execute wrappers', async () => {
    // Register a mock MCP tool and ensure agent can successfully call it
    const mockMcpTools = {
      'mock_mcp_query': {
        name: 'mock_mcp_query',
        description: 'Query mock DB',
        parameters: { type: 'object', properties: {} },
        execute: async (args) => {
          return { success: true, records: [{ id: 42, name: 'Sample' }] };
        }
      }
    };

    registerMcpTools(mockMcpTools);

    // Call the newly registered tool via tools registry directly
    assert.ok(tools['mock_mcp_query']);
    const result = await tools['mock_mcp_query'].execute({});
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.records[0].id, 42);
  });

  await t.test('Use Case 7: Text-based tool call fallback parsing and cleanup', async () => {
    const sessionId = 'test-usecase-7-fallback';

    // 1. JSON markdown code block style
    mockFetchResponses.push({
      json: {
        choices: [{
          message: {
            role: 'assistant',
            content: 'I will write this file for you:\n\n```json\n{\n  "name": "writeFile",\n  "arguments": {\n    "path": "test-fallback.txt",\n    "content": "Gemma 4 was here"\n  }\n}\n```\nLet me know if you need anything else!'
          }
        }]
      }
    });

    // Mock response after tool execution
    mockFetchResponses.push({
      json: {
        choices: [{
          message: {
            role: 'assistant',
            content: 'I have successfully created the file.'
          }
        }]
      }
    });

    const res = await runAgentTurn(sessionId, 'write a file using gemma 4 fallback format', 'gemma4:latest', 'balanced');
    
    // Assert response is cleaned of the JSON tool call block
    assert.ok(!res.text.includes('```json'));
    assert.ok(!res.text.includes('writeFile'));
    assert.ok(res.text.includes('I have successfully created the file.'));

    // Verify session recorded the tool call and tool response
    const session = await sessionService.getSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId
    });
    assert.ok(session);
    const eventTypes = session.events.map(e => e.type);
    assert.ok(eventTypes.includes('tool_call'));
    assert.ok(eventTypes.includes('tool_result'));

    // Check that the file was actually written to the workspace to verify the tool executed
    const readFileResult = await tools.readFile.execute({ path: 'test-fallback.txt' });
    assert.strictEqual(readFileResult.success, true);
    assert.strictEqual(readFileResult.content, 'Gemma 4 was here');

    // Clean up the file
    await tools.deleteFile.execute({ path: 'test-fallback.txt' });
  });

  await t.test('Use Case 8: Text-based tool call fallback XML tag styles', async () => {
    const sessionId = 'test-usecase-8-tags';

    // 2. Tagged XML-style call
    mockFetchResponses.push({
      json: {
        choices: [{
          message: {
            role: 'assistant',
            content: 'Creating nested directories. <tool_call name="makeDirectory">{"path": "nested-fallback/dir"}</tool_call> Done.'
          }
        }]
      }
    });

    mockFetchResponses.push({
      json: {
        choices: [{
          message: {
            role: 'assistant',
            content: 'Directory is ready!'
          }
        }]
      }
    });

    const res = await runAgentTurn(sessionId, 'create directory nested-fallback/dir', 'gemma4:latest', 'balanced');
    assert.ok(res.text.includes('nested directories'));
    assert.ok(res.text.includes('Directory is ready!'));

    // Check directory creation
    const listResult = await tools.listFiles.execute({});
    assert.ok(listResult.files.some(f => f.name.includes('nested-fallback')));

    // Clean up directory
    await tools.deleteFile.execute({ path: 'nested-fallback' });
  });

  await t.test('Use Case 9: Text-based tool call fallback custom tag style', async () => {
    const sessionId = 'test-usecase-9-custom-tags';

    // 3. Custom-tagged call
    mockFetchResponses.push({
      json: {
        choices: [{
          message: {
            role: 'assistant',
            content: 'Let me do calculator. <call_calculator>{"expression": "4 * 5"}</call_calculator> Nice.'
          }
        }]
      }
    });

    mockFetchResponses.push({
      json: {
        choices: [{
          message: {
            role: 'assistant',
            content: 'Result is 20.'
          }
        }]
      }
    });

    const res = await runAgentTurn(sessionId, 'calculate 4 * 5', 'gemma4:latest', 'balanced');
    assert.ok(res.text.includes('calculator'));
    assert.ok(res.text.includes('Result is 20.'));
  });

  await t.test('Use Case 9.5: Text-based tool call fallback function tag style', async () => {
    const sessionId = 'test-usecase-9-5-function-tags';

    // 1. Tool call with <function=toolName>
    mockFetchResponses.push({
      json: {
        choices: [{
          message: {
            role: 'assistant',
            content: 'Listing workspace files. <function=listFiles>  </tool_call> Finished.'
          }
        }]
      }
    });

    // 2. Response after tool executes
    mockFetchResponses.push({
      json: {
        choices: [{
          message: {
            role: 'assistant',
            content: 'Found files in the workspace.'
          }
        }]
      }
    });

    const res = await runAgentTurn(sessionId, 'list the files in the workspace', 'gemma4:latest', 'balanced');
    assert.ok(res.text.includes('Listing workspace files.'));
    assert.ok(res.text.includes('Found files in the workspace.'));
  });

  await t.test('Use Case 9.6: Text-based tool call fallback Qwen tag style', async () => {
    const sessionId = 'test-usecase-9-6-qwen-tags';

    // 1. Tool call with <tool_call>JSON</tool_call> (Qwen style)
    mockFetchResponses.push({
      json: {
        choices: [{
          message: {
            role: 'assistant',
            content: 'Let me do calculator. <tool_call>{"name": "calculator", "arguments": {"expression": "10 + 10"}}</tool_call> Nice.'
          }
        }]
      }
    });

    // 2. Response after tool executes
    mockFetchResponses.push({
      json: {
        choices: [{
          message: {
            role: 'assistant',
            content: 'Result is 20.'
          }
        }]
      }
    });

    const res = await runAgentTurn(sessionId, 'calculate 10 + 10', 'qwen:latest', 'balanced');
    assert.ok(res.text.includes('calculator'));
    assert.ok(res.text.includes('Result is 20.'));
  });

  await t.test('Use Case 10: Verbose JSON logging control', async () => {
    const originalValue = isVerboseJsonEnabled();
    try {
      setVerboseJsonEnabled(true);
      assert.strictEqual(isVerboseJsonEnabled(), true);

      setVerboseJsonEnabled(false);
      assert.strictEqual(isVerboseJsonEnabled(), false);
    } finally {
      setVerboseJsonEnabled(originalValue);
    }
  });

  await t.test('Use Case 11: Session Service state and Info JSON data assembly', async () => {
    const sessionId = 'test-usecase-11-info';
    
    // Create the session first
    await sessionService.createSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId
    });

    const session = await sessionService.getSession({
      appName: 'plumar-cli',
      userId: 'default-user',
      sessionId
    });

    assert.ok(session);

    // Append some dummy data event
    await sessionService.appendEvent({
      session,
      event: { role: 'user', content: 'test event' }
    });

    assert.strictEqual(session.events.length, 1);
    assert.strictEqual(session.events[0].content, 'test event');

    // Build standard JSON info representation to ensure fields are populated correctly
    const infoPayload = {
      activeModel: 'gemma4:latest',
      activeMode: 'balanced',
      sessionId,
      workspaceRoot: '/some/path',
      ollamaEndpoint: 'http://localhost:11434',
      verboseJsonLogs: isVerboseJsonEnabled(),
      session
    };

    assert.strictEqual(infoPayload.activeModel, 'gemma4:latest');
    assert.strictEqual(infoPayload.activeMode, 'balanced');
    assert.strictEqual(infoPayload.sessionId, sessionId);
    assert.strictEqual(infoPayload.session.events[0].content, 'test event');
  });

  await t.test('Use Case 12: ADK info logging control and default state', async () => {
    const originalValue = isAdkInfoEnabled();
    try {
      // It should be disabled by default (false)
      assert.strictEqual(isAdkInfoEnabled(), false);

      setAdkInfoEnabled(true);
      assert.strictEqual(isAdkInfoEnabled(), true);

      setAdkInfoEnabled(false);
      assert.strictEqual(isAdkInfoEnabled(), false);
    } finally {
      setAdkInfoEnabled(originalValue);
    }
  });

  await t.test('Use Case 13: Tool Execution Policies (allow, ask, deny)', async () => {
    const originalDefault = getToolPolicy('calculator'); // should be default which is 'ask'
    assert.strictEqual(originalDefault, 'ask');

    try {
      // 1. Set specific policy to deny
      setToolPolicy('calculator', 'deny');
      assert.strictEqual(getToolPolicy('calculator'), 'deny');

      // 2. Set default policy to allow
      setDefaultPolicy('allow');
      assert.strictEqual(getToolPolicy('some-other-tool'), 'allow');
      assert.strictEqual(getToolPolicy('calculator'), 'deny'); // Specific override remains 'deny'

      // 3. Reset specific policy
      setToolPolicy('calculator', null);
      assert.strictEqual(getToolPolicy('calculator'), 'allow'); // Falls back to default which is now 'allow'
      
      // 4. Test deny policy on an actual runAgentTurn
      setToolPolicy('calculator', 'deny');
      const sessionId = 'test-policy-deny';
      mockFetchResponses.push({
        json: {
          choices: [{
            message: {
              role: 'assistant',
              content: '<thinking>I need to calculate 2 + 2.</thinking>',
              tool_calls: [{
                id: 'call_calculator_policy_test',
                type: 'function',
                function: {
                  name: 'calculator',
                  arguments: JSON.stringify({ expression: '2 + 2' })
                }
              }]
            }
          }]
        }
      });
      // Second response after tool execution is blocked
      mockFetchResponses.push({
        json: {
          choices: [{
            message: {
              role: 'assistant',
              content: 'I could not execute the calculator because it was blocked.'
            }
          }]
        }
      });

      const res = await runAgentTurn(sessionId, 'calculate 2+2', 'gemma4:latest', 'balanced');
      assert.ok(res.text.includes('blocked') || res.text.includes('could not execute'));
      
      // Check that the tool result recorded in session contains the blocked rejection error
      const session = await sessionService.getSession({
        appName: 'plumar-cli',
        userId: 'default-user',
        sessionId
      });
      assert.ok(session);
      const toolResponseEvent = session.events.find(e => e.type === 'tool_result');
      assert.ok(toolResponseEvent);
      assert.ok(JSON.stringify(toolResponseEvent).includes('User policy blocks \\"calculator\\"'));

    } finally {
      setDefaultPolicy('ask');
      setToolPolicy('calculator', null);
    }
  });

  await t.test('Use Case 14: Persistent Policy Configuration Files (per-tool loading, saving, auto-persist)', async () => {
    const testConfigPath = 'test-policy-config.json';
    
    // Ensure cleanup of previous test run
    if (fs.existsSync(testConfigPath)) {
      try { fs.unlinkSync(testConfigPath); } catch (e) {}
    }

    try {
      // 1. Initial State
      setActivePolicyConfigFile(null);
      setDefaultPolicy('allow');
      setToolPolicy('calculator', null);

      // 2. Save configuration to file
      setDefaultPolicy('ask');
      setToolPolicy('calculator', 'deny');
      setToolPolicy('writeFile', 'allow');
      
      const saved = savePolicyConfig(testConfigPath);
      assert.strictEqual(saved, true);
      assert.strictEqual(getActivePolicyConfigFile(), testConfigPath);

      // Verify file content matches
      const fileData = JSON.parse(fs.readFileSync(testConfigPath, 'utf8'));
      assert.strictEqual(fileData.default, 'ask');
      assert.strictEqual(fileData.tools.calculator, 'deny');
      assert.strictEqual(fileData.tools.writeFile, 'allow');

      // Reset in-memory state
      setActivePolicyConfigFile(null);
      setDefaultPolicy('allow');
      setToolPolicy('calculator', null);
      setToolPolicy('writeFile', null);

      assert.strictEqual(getDefaultPolicy(), 'allow');
      assert.strictEqual(getToolPolicy('calculator'), 'allow');

      // 3. Load configuration from file
      const loaded = loadPolicyConfig(testConfigPath);
      assert.strictEqual(loaded, true);
      assert.strictEqual(getActivePolicyConfigFile(), testConfigPath);
      assert.strictEqual(getDefaultPolicy(), 'ask');
      assert.strictEqual(getToolPolicy('calculator'), 'deny');
      assert.strictEqual(getToolPolicy('writeFile'), 'allow');

      // 4. Test Auto-persist (setting dynamic policies on active config saves changes)
      setToolPolicy('calculator', 'allow');
      setDefaultPolicy('deny');

      const reloadedData = JSON.parse(fs.readFileSync(testConfigPath, 'utf8'));
      assert.strictEqual(reloadedData.default, 'deny');
      assert.strictEqual(reloadedData.tools.calculator, 'allow');

    } finally {
      // Cleanup
      setActivePolicyConfigFile(null);
      setDefaultPolicy('ask');
      setToolPolicy('calculator', null);
      setToolPolicy('writeFile', null);
      if (fs.existsSync(testConfigPath)) {
        try { fs.unlinkSync(testConfigPath); } catch (e) {}
      }
    }
  });

  await t.test('checkToolPermission uppercase responses set permanent policies', async () => {
    let mockAnswer = '';
    const mockRl = {
      question: async () => mockAnswer
    };
    
    const { setReadlineInterface, checkToolPermission, getToolPolicy, setToolPolicy } = await import('../src/agent.js');
    setReadlineInterface(mockRl);
    
    try {
      // Test capital 'Y' sets policy to 'allow' permanently for this session
      setToolPolicy('calculator', 'ask');
      mockAnswer = 'Y';
      const approved1 = await checkToolPermission('calculator', {});
      assert.strictEqual(approved1, true);
      assert.strictEqual(getToolPolicy('calculator'), 'allow');

      // Test capital 'N' sets policy to 'deny' permanently for this session
      setToolPolicy('calculator', 'ask');
      mockAnswer = 'N';
      const approved2 = await checkToolPermission('calculator', {});
      assert.strictEqual(approved2, false);
      assert.strictEqual(getToolPolicy('calculator'), 'deny');

      // Test lowercase 'y' does NOT set policy permanently (keeps 'ask')
      setToolPolicy('calculator', 'ask');
      mockAnswer = 'y';
      const approved3 = await checkToolPermission('calculator', {});
      assert.strictEqual(approved3, true);
      assert.strictEqual(getToolPolicy('calculator'), 'ask');

      // Test lowercase 'n' does NOT set policy permanently (keeps 'ask')
      setToolPolicy('calculator', 'ask');
      mockAnswer = 'n';
      const approved4 = await checkToolPermission('calculator', {});
      assert.strictEqual(approved4, false);
      assert.strictEqual(getToolPolicy('calculator'), 'ask');
    } finally {
      setReadlineInterface(null);
      setToolPolicy('calculator', null);
    }
  });

  await t.test('Use Case 8: Ollama Endpoint Settings auto-save and configuration loading', async () => {
    const testConfigPath = 'test-settings-config.json';
    const originalEnv = process.env.OLLAMA_HOST;
    
    try {
      // 1. Initial save should include settings.ollamaEndpoint
      setOllamaBaseUrl('http://10.0.0.2:11434');
      const saved = savePolicyConfig(testConfigPath);
      assert.strictEqual(saved, true);
      assert.strictEqual(getActivePolicyConfigFile(), testConfigPath);

      // Verify file content includes settings object
      const fileData = JSON.parse(fs.readFileSync(testConfigPath, 'utf8'));
      assert.ok(fileData.settings);
      assert.strictEqual(fileData.settings.ollamaEndpoint, 'http://10.0.0.2:11434');

      // 2. Change env directly to simulate reload
      process.env.OLLAMA_HOST = 'http://localhost:11434';
      assert.strictEqual(getOllamaBaseUrl(), 'http://localhost:11434');

      // 3. Load config and verify it sets the url back
      const loaded = loadPolicyConfig(testConfigPath);
      assert.strictEqual(loaded, true);
      assert.strictEqual(getOllamaBaseUrl(), 'http://10.0.0.2:11434');

      // 4. Test auto-persist on base URL update
      setOllamaBaseUrl('https://remote-endpoint.local:4567');
      const fileData2 = JSON.parse(fs.readFileSync(testConfigPath, 'utf8'));
      assert.strictEqual(fileData2.settings.ollamaEndpoint, 'https://remote-endpoint.local:4567');
      assert.strictEqual(getOllamaBaseUrl(), 'https://remote-endpoint.local:4567');

    } finally {
      // Cleanup
      setActivePolicyConfigFile(null);
      process.env.OLLAMA_HOST = originalEnv;
      if (fs.existsSync(testConfigPath)) {
        try { fs.unlinkSync(testConfigPath); } catch (e) {}
      }
    }
  });

  await t.test('Image generation capability and text-only model limitation', async () => {
    let capturedPayload = null;
    const previousFetch = globalThis.fetch;
    
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
      if (options && options.body) {
        try {
          capturedPayload = JSON.parse(options.body);
        } catch (e) {
          // ignore
        }
      }
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          message: {
            role: 'assistant',
            content: 'Response'
          }
        })
      };
    };

    try {
      // 1. Test image capable model (gemma4)
      await runAgentTurn('test-img-capable', 'generate an image of a potato', 'gemma4:latest', 'balanced');
      assert.ok(capturedPayload);
      const systemMsgGemma = capturedPayload.messages.find(m => m.role === 'system');
      assert.ok(systemMsgGemma);
      assert.ok(systemMsgGemma.content.includes('NATIVE MODEL IMAGE GENERATION'));
      assert.ok(!systemMsgGemma.content.includes('TEXT-ONLY LIMITATION'));
      
      // Since generateImage is exposed directly, it should be present in gemma4's payload
      const gemmaTools = capturedPayload.tools || [];
      const hasGenerateImageGemma = gemmaTools.some(t => t.function && t.function.name === 'generateImage');
      assert.strictEqual(hasGenerateImageGemma, true);

      // But base64Convert tool should be present for gemma4
      const hasBase64Gemma = gemmaTools.some(t => t.function && t.function.name === 'base64Convert');
      assert.ok(hasBase64Gemma);

      capturedPayload = null;

      // 2. Test text-only model (e.g. llama3)
      await runAgentTurn('test-text-only', 'generate an image of a potato', 'llama3:latest', 'balanced');
      assert.ok(capturedPayload);
      const systemMsgLlama = capturedPayload.messages.find(m => m.role === 'system');
      assert.ok(systemMsgLlama);
      assert.ok(systemMsgLlama.content.includes('LOCAL TOOL IMAGE GENERATION'));
      assert.ok(!systemMsgLlama.content.includes('NATIVE MODEL IMAGE GENERATION'));

      // Since generateImage is exposed directly, it should be present in llama3's payload
      const llamaTools = capturedPayload.tools || [];
      const hasGenerateImageLlama = llamaTools.some(t => t.function && t.function.name === 'generateImage');
      assert.strictEqual(hasGenerateImageLlama, true);

    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  await t.test('ADK image response storing from Ollama', async () => {
    const previousFetch = globalThis.fetch;
    const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='; // valid 1x1 PNG
    
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
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          message: {
            role: 'assistant',
            content: 'Here is your birthday cake image!',
            images: [testImageBase64]
          }
        })
      };
    };

    try {
      const sessionId = 'test-adk-image-store-' + Date.now();
      const res = await runAgentTurn(sessionId, 'generate an image of a birthday cake cake.png', 'gemma4:latest', 'balanced');
      
      // The direct file save should have written the cake.png to disk
      const targetFilePath = path.join(process.cwd(), 'cake.png');
      assert.ok(fs.existsSync(targetFilePath), 'Direct workspace file cake.png should exist');
      fs.unlinkSync(targetFilePath); // clean up

      // The ADK FileArtifactService should have saved the artifact to .antigravitycli/sessions/users/default-user/sessions/{sessionId}/artifacts/
      const artifactsBaseDir = path.join(process.cwd(), '.antigravitycli', 'sessions', 'users', 'default-user', 'sessions', sessionId, 'artifacts');
      assert.ok(fs.existsSync(artifactsBaseDir), 'Artifact directory should exist');
      
      // Let's verify files are there
      const artifactDirs = fs.readdirSync(artifactsBaseDir);
      assert.ok(artifactDirs.length > 0, 'Should have saved at least one artifact');
      
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  await t.test('Use Case 13: session token tracking should count tokens from Ollama API or fallback estimation', async () => {
    resetSessionTokens();

    // Verify initial count is zero
    assert.deepStrictEqual(getSessionTokens(), { input: 0, output: 0, total: 0 });

    // Mock an Ollama response with native prompt_eval_count and eval_count
    mockFetchResponses.push({
      json: {
        choices: [{
          message: {
            role: 'assistant',
            content: 'Hello, world!'
          }
        }],
        prompt_eval_count: 15,
        eval_count: 8
      }
    });

    const sessionId = 'test-token-tracking';
    await runAgentTurn(sessionId, 'hi', 'gemma4:latest', 'balanced');

    // Verify token tracking counted native values correctly
    assert.deepStrictEqual(getSessionTokens(), { input: 15, output: 8, total: 23 });

    // Mock another response without prompt_eval_count or eval_count to test character estimation fallback
    resetSessionTokens();
    mockFetchResponses.push({
      json: {
        choices: [{
          message: {
            role: 'assistant',
            content: 'A response that is longer.'
          }
        }]
      }
    });

    await runAgentTurn(sessionId, 'hi', 'gemma4:latest', 'balanced');

    const tokens = getSessionTokens();
    assert.ok(tokens.input > 0, 'Estimated input tokens should be greater than 0');
    assert.ok(tokens.output > 0, 'Estimated output tokens should be greater than 0');
    assert.strictEqual(tokens.total, tokens.input + tokens.output, 'Total tokens should equal input plus output');
  });

  await t.test('Use Case 15: Should include Background Process and Execution Guidance in systemPrompt', async () => {
    // We capture the systemPrompt by hooking into LlmAgent
    mockFetchResponses.push({
      json: {
        choices: [{
          message: {
            role: 'assistant',
            content: 'Background execution guidance checked!'
          }
        }]
      }
    });

    const previousFetch = globalThis.fetch;
    let capturedSystemPrompt = '';

    globalThis.fetch = async (url, options) => {
      if (url.endsWith('/api/chat')) {
        const body = JSON.parse(options.body);
        const systemMsg = body.messages.find(m => msg => msg.role === 'system' || m.role === 'system');
        if (systemMsg) {
          capturedSystemPrompt = systemMsg.content;
        } else {
          // If messages array has system prompt in another structure, extract it
          const firstMsg = body.messages[0];
          if (firstMsg && firstMsg.role === 'system') {
            capturedSystemPrompt = firstMsg.content;
          }
        }
      }
      return {
        ok: true,
        json: async () => ({
          message: {
            role: 'assistant',
            content: 'Success'
          },
          prompt_eval_count: 10,
          eval_count: 5
        })
      };
    };

    try {
      await runAgentTurn('test-bg-prompt', 'execute task in background', 'gemma4:latest', 'balanced');
      assert.ok(capturedSystemPrompt.includes('Background Process and Execution Guidance'), 'System prompt should include background guidance');
      assert.ok(capturedSystemPrompt.includes('YOU CAN RUN BACKGROUND COMMANDS'), 'System prompt should explain background execution capabilities');
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});


