import test from 'node:test';
import assert from 'node:assert/strict';
import { formatChatResponse } from '../src/formatter.js';

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
});
