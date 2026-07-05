import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Create a unique temporary directory for this test
const testTempDir = path.join(process.cwd(), 'tests', 'temp-home-settings-test');

test('Global Chat Modes Settings Suite', async (t) => {
  // Mock process.cwd() globally for all subsequent imports
  const originalCwd = process.cwd;
  process.cwd = () => testTempDir;

  t.after(async () => {
    // Restore original cwd and clean up temp folder
    process.cwd = originalCwd;
    try {
      await fs.rm(testTempDir, { recursive: true, force: true });
    } catch (e) {}
  });

  await t.test('Should initialize default settings in ./.plumar/settings.json if missing', async () => {
    // Make sure clean state
    try {
      await fs.rm(testTempDir, { recursive: true, force: true });
    } catch (e) {}

    // Dynamic import to execute initialization with mocked cwd
    const { CHAT_MODES, initChatModes } = await import('../src/chat-modes.js');

    initChatModes();

    // Verify ./.plumar/settings.json was created
    const settingsPath = path.join(testTempDir, '.plumar', 'settings.json');
    const stats = await fs.stat(settingsPath);
    assert.ok(stats.isFile());

    // Read and verify default modes exist inside the file
    const content = await fs.readFile(settingsPath, 'utf8');
    const parsed = JSON.parse(content);
    assert.ok(parsed.chatModes);
    assert.ok(parsed.chatModes.balanced);
    assert.ok(parsed.chatModes.code);
    assert.ok(parsed.chatModes.system);
    assert.ok(parsed.chatModes.creative);

    // Verify in-memory CHAT_MODES are populated
    assert.equal(CHAT_MODES.balanced.name, 'Balanced Assistant');
  });

  await t.test('Should merge user-defined chat modes from settings.json', async () => {
    const settingsPath = path.join(testTempDir, '.plumar', 'settings.json');

    // Define custom chat modes settings
    const customSettings = {
      chatModes: {
        balanced: {
          name: 'Super Balanced',
          emoji: '',
          description: 'A custom balanced mode',
          temperature: 0.5,
          systemPrompt: 'You are custom balanced.'
        },
        expert: {
          name: 'Expert Consultant',
          emoji: '',
          description: 'A specialized expert',
          temperature: 0.1,
          systemPrompt: 'You are an expert.'
        }
      }
    };

    // Write custom settings
    await fs.writeFile(settingsPath, JSON.stringify(customSettings, null, 2), 'utf8');

    // Import and initialize to load custom modes
    const { CHAT_MODES, initChatModes } = await import('../src/chat-modes.js');
    initChatModes();

    // Verify custom balanced was loaded/updated
    assert.equal(CHAT_MODES.balanced.name, 'Super Balanced');
    assert.equal(CHAT_MODES.balanced.emoji, '');
    assert.equal(CHAT_MODES.balanced.temperature, 0.5);
    assert.equal(CHAT_MODES.balanced.systemPrompt, 'You are custom balanced.');

    // Verify expert (a completely new mode) was successfully created
    assert.ok(CHAT_MODES.expert);
    assert.equal(CHAT_MODES.expert.name, 'Expert Consultant');
    assert.equal(CHAT_MODES.expert.emoji, '');
    assert.equal(CHAT_MODES.expert.temperature, 0.1);
    assert.equal(CHAT_MODES.expert.systemPrompt, 'You are an expert.');

    // Default system/creative should remain intact since they fallback/get re-initialized
    // Wait, let's verify if they were re-populated from defaultChatModes when parsed.chatModes didn't define them
    assert.ok(CHAT_MODES.system);
    assert.equal(CHAT_MODES.system.name, 'System Operator');
  });
});
