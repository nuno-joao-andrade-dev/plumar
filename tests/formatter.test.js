import test from 'node:test';
import assert from 'node:assert/strict';
import { formatChatResponse, printModelSelection } from '../src/formatter.js';

test('Formatter JSON Output Suite', async (t) => {
  await t.test('formatChatResponse: should bypass non-JSON plain text', () => {
    const text = 'Hello, this is standard text response.';
    const result = formatChatResponse(text);
    assert.equal(result, text);
  });

  await t.test('formatChatResponse: should format pure JSON array of objects as table', () => {
    const jsonStr = `[
      {"name": "Alice", "role": "Developer"},
      {"name": "Bob", "role": "Architect"}
    ]`;
    const result = formatChatResponse(jsonStr);
    assert.ok(result.includes('Alice'));
    assert.ok(result.includes('Bob'));
    assert.ok(result.includes('Developer'));
    assert.ok(result.includes('┌')); // Box drawing border
  });

  await t.test('formatChatResponse: should format pure JSON object (key-value) as table', () => {
    const jsonStr = `{"status": "success", "count": 42}`;
    const result = formatChatResponse(jsonStr);
    assert.ok(result.includes('status'));
    assert.ok(result.includes('success'));
    assert.ok(result.includes('count'));
    assert.ok(result.includes('┌')); // Box drawing border
  });

  await t.test('formatChatResponse: should format JSON object with multi-line string values elegantly', () => {
    const jsonStr = `{"success": true, "stdout": "Hello, World!\\n", "stderr": "line 1\\nline 2"}`;
    const result = formatChatResponse(jsonStr);
    assert.ok(result.includes('success'));
    assert.ok(result.includes('stdout'));
    assert.ok(result.includes('Hello, World!'));
    assert.ok(result.includes('line 1'));
    assert.ok(result.includes('line 2'));
    assert.ok(result.includes('┌'));
    
    // There should NOT be an empty padded line for the trailing newline of Hello, World!
    // Since we split and popped, Hello, World! should be printed as a single line, 
    // and there should not be any line below it starting with a blank label and trailing spaces.
    const lines = result.split('\n');
    const stdoutHeaderLine = lines.find(line => line.includes('stdout'));
    assert.ok(stdoutHeaderLine, 'stdout row should exist');
    
    // Ensure both line 1 and line 2 of stderr are present on separate rows
    const stderrLine1 = lines.find(line => line.includes('line 1'));
    const stderrLine2 = lines.find(line => line.includes('line 2'));
    assert.ok(stderrLine1, 'stderr line 1 should exist');
    assert.ok(stderrLine2, 'stderr line 2 should exist');
    
    // Check that the second line of stderr does NOT duplicate the label/key "stderr"
    assert.ok(!stderrLine2.includes('stderr'), 'second line of multi-line value should not duplicate key');
  });

  await t.test('formatChatResponse: should format markdown enclosed JSON block as table', () => {
    const markdownStr = `\`\`\`json
[
  {"id": 1, "value": "A"},
  {"id": 2, "value": "B"}
]
\`\`\``;
    const result = formatChatResponse(markdownStr);
    assert.ok(result.includes('id'));
    assert.ok(result.includes('value'));
    assert.ok(result.includes('┌')); // Box drawing border
  });

  await t.test('formatChatResponse: should replace embedded JSON blocks inside mixed text', () => {
    const mixedStr = `Here is the requested table with database records:

\`\`\`json
[
  {"username": "john_doe", "status": "active"},
  {"username": "jane_smith", "status": "pending"}
]
\`\`\`

Let me know if you need any other fields!`;

    const result = formatChatResponse(mixedStr);
    assert.ok(result.includes('Here is the requested table with database records:'));
    assert.ok(result.includes('john_doe'));
    assert.ok(result.includes('jane_smith'));
    assert.ok(result.includes('┌')); // Box drawing border
    assert.ok(result.includes('Let me know if you need any other fields!'));
    assert.ok(!result.includes('```json')); // Markdown ticks should be stripped/replaced
  });

  await t.test('formatChatResponse: should format standard markdown pipe tables as box tables', () => {
    const tableStr = `Here is the summary table:

| Temperature Value | Use Case Example |
| :--- | :--- |
| **0.0** | Generating code, fact-checking. |
| **0.5 to 0.7** | Drafting emails, blog posts. |

Let me know what you think!`;

    const result = formatChatResponse(tableStr);
    assert.ok(result.includes('Here is the summary table:'));
    assert.ok(result.includes('Temperature Value'));
    assert.ok(result.includes('Use Case Example'));
    assert.ok(result.includes('0.0'));
    assert.ok(result.includes('Drafting emails'));
    assert.ok(result.includes('┌')); // Cyan Box drawing border
    assert.ok(result.includes('Let me know what you think!'));
    assert.ok(!result.includes('| :--- |')); // The original markdown separator should be gone
  });

  await t.test('formatChatResponse: should handle cells with escaped pipes in markdown tables', () => {
    const tableStr = `| Col 1 | Col 2 |
| --- | --- |
| Val 1 \\| Val 1.5 | Val 2 |`;

    const result = formatChatResponse(tableStr);
    assert.ok(result.includes('Col 1'));
    assert.ok(result.includes('Val 1 | Val 1.5'));
    assert.ok(result.includes('Val 2'));
    assert.ok(result.includes('┌')); // Box drawing border
  });

  await t.test('formatChatResponse: should keep wide table lines intact and prevent wrap corruption', () => {
    const wideTableStr = `Here is a very long table to review:

| Priority | Area | Action | Why? |
| :--- | :--- | :--- | :--- |
| High | test_performance.sh | Add set -euo pipefail to the top of the script. | Makes the script safer and robust against failure points. |
| Medium | test_performance.sh | Parameterize TARGET_URL. Read the URL from an environment variable instead of hardcoding it. | Increases reusability across different machines/environments. |
| Low | Dependencies | Run cargo audit regularly. | Maintains security and stability by flagging outdated or vulnerable dependencies. |

Please review it carefully!`;

    const result = formatChatResponse(wideTableStr);
    
    // The top border of the table should be a single continuous line starting with ┌
    const lines = result.split('\n');
    const borderLine = lines.find(line => line.includes('┌'));
    assert.ok(borderLine, 'Table top border line should exist');
    
    // In a wrapped scenario, the line containing '┌' would be short or broken,
    // and subsequent lines would contain parts of headers. Here, we ensure
    // that the table contains the complete uninterrupted lines.
    assert.ok(borderLine.includes('┐'), 'Table top border line should be complete on a single line');
    
    const middleBorderLine = lines.find(line => line.includes('├'));
    assert.ok(middleBorderLine, 'Table middle border line should exist');
    assert.ok(middleBorderLine.includes('┤'), 'Table middle border line should be complete on a single line');

    const bottomBorderLine = lines.find(line => line.includes('└'));
    assert.ok(bottomBorderLine, 'Table bottom border line should exist');
    assert.ok(bottomBorderLine.includes('┘'), 'Table bottom border line should be complete on a single line');
  });

  await t.test('printModelSelection: should print models and characteristics correctly', () => {
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    try {
      const mockModels = [
        {
          name: 'gemma4:latest',
          size: 4800000000,
          details: {
            family: 'llama',
            parameter_size: '9B',
            quantization_level: 'Q4_K_M'
          }
        },
        'codegemma:latest'
      ];
      
      printModelSelection(mockModels, 'gemma4:latest');
      
      const fullLogStr = logs.join('\n');
      assert.ok(fullLogStr.includes('gemma4:latest'));
      assert.ok(fullLogStr.includes('codegemma:latest'));
      assert.ok(fullLogStr.includes('llama'));
      assert.ok(fullLogStr.includes('9B'));
      assert.ok(fullLogStr.includes('Q4_K_M'));
      assert.ok(fullLogStr.includes('4.5 GB'));
      assert.ok(fullLogStr.includes('Tools: Native'));
    } finally {
      console.log = originalLog;
    }
  });

  await t.test('process.stdin interceptor: should correctly reconstruct split terminal responses and strip them, while preserving normal input', async () => {
    const received = [];
    const onData = (chunk) => {
      received.push(chunk.toString('utf8'));
    };
    process.stdin.on('data', onData);

    try {
      // 1. Emit a normal chunk - should be received immediately
      process.stdin.emit('data', Buffer.from('Hi', 'utf8'));
      assert.deepEqual(received, ['Hi']);
      received.length = 0;

      // 2. Emit a split OSC response chunk 1 - should be buffered (not received yet)
      process.stdin.emit('data', Buffer.from('\x1b]11;r', 'utf8'));
      assert.deepEqual(received, []);

      // 3. Emit split OSC response chunk 2 - should complete the query response and be completely stripped (not received)
      process.stdin.emit('data', Buffer.from('gb:0000/0000/0000\x07', 'utf8'));
      assert.deepEqual(received, []);

      // 4. Emit another normal chunk - should be received immediately
      process.stdin.emit('data', Buffer.from('World', 'utf8'));
      assert.deepEqual(received, ['World']);
      received.length = 0;

      // 5. Emit a partial OSC response and wait for timeout to flush
      process.stdin.emit('data', Buffer.from('\x1b]11;abc', 'utf8'));
      assert.deepEqual(received, []);

      // Wait 50ms for the flush timeout
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Since it's flush-timed out, we expect the filtered version to be emitted.
      // "\x1b]11;abc" has "\x1b]11;" stripped by stripTerminalResponses, leaving "abc".
      assert.deepEqual(received, ['abc']);
    } finally {
      process.stdin.removeListener('data', onData);
    }
  });
});
