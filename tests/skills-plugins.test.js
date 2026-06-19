import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { 
  parseSkillMd, 
  formatSkillMd, 
  createSkill, 
  createPlugin, 
  loadAllSkills, 
  loadAllPlugins, 
  getLoadedSkills, 
  getLoadedPlugins 
} from '../src/skills-plugins-manager.js';
import { tools } from '../src/tools.js';

test('Skills and Plugins Manager Suite', async (t) => {
  const testWorkspace = process.cwd();
  
  // Cleanup test artifacts after tests run
  t.after(async () => {
    try {
      await fs.rm(path.join(testWorkspace, 'skills', 'test-skill-temp'), { recursive: true, force: true });
    } catch (e) {}
    try {
      await fs.rm(path.join(testWorkspace, 'plugins', 'test-plugin-temp.js'), { force: true });
    } catch (e) {}
  });

  await t.test('parseSkillMd: should parse valid SKILL.md with frontmatter', () => {
    const content = `---
name: test-skill
description: "A simple test skill description"
tags: "test, mock"
---

# Instructions
1. Perform action A.
2. Verify output.`;

    const parsed = parseSkillMd(content);
    assert.equal(parsed.frontmatter.name, 'test-skill');
    assert.equal(parsed.frontmatter.description, 'A simple test skill description');
    assert.equal(parsed.frontmatter.tags, 'test, mock');
    assert.ok(parsed.instructions.includes('Perform action A.'));
  });

  await t.test('parseSkillMd: should throw error for invalid SKILL.md missing frontmatter', () => {
    const content = `Invalid content without frontmatter delimiters.`;
    assert.throws(() => parseSkillMd(content));
  });

  await t.test('createSkill & loadAllSkills: should programmatically create and reload skill', async () => {
    const name = 'test-skill-temp';
    const description = 'Temp skill for unit tests';
    const tags = ['unit-test', 'loader'];
    const instructions = 'Instructions for unit test skill.';

    const skill = await createSkill(name, description, tags, instructions);
    assert.equal(skill.name, name);
    assert.equal(skill.frontmatter.description, description);
    
    // Verify directory exists
    const skillPath = path.join(testWorkspace, 'skills', name);
    const skillMdPath = path.join(skillPath, 'SKILL.md');
    
    const content = await fs.readFile(skillMdPath, 'utf-8');
    assert.ok(content.includes('name: "test-skill-temp"'));
    
    // Check in-memory maps
    const skills = getLoadedSkills();
    assert.ok(skills[name]);
  });

  await t.test('createPlugin & loadAllPlugins: should programmatically create and reload plugin', async () => {
    const fileName = 'test-plugin-temp.js';
    const codeContent = `import { FunctionTool } from '@google/adk';
import { z } from 'zod';

export const testPluginTool = new FunctionTool({
  name: 'testPluginTool',
  description: 'Test plugin tool description',
  parameters: z.object({}),
  execute: async () => {
    return { success: true, fromPlugin: true };
  }
});
`;

    const plugin = await createPlugin(fileName, codeContent);
    assert.equal(plugin.fileName, fileName);
    
    const plugins = getLoadedPlugins();
    assert.ok(plugins[fileName]);
    assert.equal(plugins[fileName].tools.length, 1);
    assert.equal(plugins[fileName].tools[0].name, 'testPluginTool');
  });

  await t.test('Tools Integration: listSkills and loadSkill should function correctly', async () => {
    const listRes = await tools.listSkills.execute({});
    assert.ok(listRes.success);
    assert.ok(Array.isArray(listRes.skills));
    
    const testSkill = listRes.skills.find(s => s.name === 'test-skill-temp');
    assert.ok(testSkill);
    assert.equal(testSkill.description, 'Temp skill for unit tests');

    const loadRes = await tools.loadSkill.execute({ name: 'test-skill-temp' });
    assert.ok(loadRes.success);
    assert.equal(loadRes.name, 'test-skill-temp');
    assert.equal(loadRes.instructions, 'Instructions for unit test skill.');
  });
});
