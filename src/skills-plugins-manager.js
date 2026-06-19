import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { FunctionTool } from '@google/adk';

const WORKSPACE_DIR = process.cwd();
const SKILLS_DIR = path.join(WORKSPACE_DIR, 'skills');
const PLUGINS_DIR = path.join(WORKSPACE_DIR, 'plugins');

// In-memory cache
const loadedSkills = {};
const loadedPlugins = {};

/**
 * Ensures that the skills and plugins directories exist.
 */
export async function ensureDirsExist() {
  try {
    await fs.mkdir(SKILLS_DIR, { recursive: true });
  } catch (err) {
    // Ignore
  }
  try {
    await fs.mkdir(PLUGINS_DIR, { recursive: true });
  } catch (err) {
    // Ignore
  }
}

/**
 * Parses SKILL.md content into frontmatter and instructions.
 * Supports simple YAML-like frontmatter.
 */
export function parseSkillMd(content) {
  if (!content.trim().startsWith('---')) {
    throw new Error('SKILL.md must start with frontmatter bounded by "---"');
  }
  
  const parts = content.split('---');
  if (parts.length < 3) {
    throw new Error('SKILL.md frontmatter not properly closed with "---"');
  }
  
  const frontmatterStr = parts[1];
  const instructions = parts.slice(2).join('---').trim();
  
  const frontmatter = {};
  const lines = frontmatterStr.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex !== -1) {
      const key = trimmed.slice(0, colonIndex).trim();
      let value = trimmed.slice(colonIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      frontmatter[key] = value;
    }
  }
  
  if (!frontmatter.name) {
    throw new Error('Skill frontmatter must define a "name" property.');
  }
  if (!frontmatter.description) {
    throw new Error('Skill frontmatter must define a "description" property.');
  }
  
  return { frontmatter, instructions };
}

/**
 * Format skill frontmatter and instructions to a full SKILL.md string.
 */
export function formatSkillMd(frontmatter, instructions) {
  let content = '---\n';
  for (const [key, value] of Object.entries(frontmatter)) {
    content += `${key}: "${value.replace(/"/g, '\\"')}"\n`;
  }
  content += '---\n\n';
  content += instructions;
  return content;
}

/**
 * Loads all skills from the skills/ directory.
 */
export async function loadAllSkills() {
  await ensureDirsExist();
  const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
  
  // Clear existing loaded skills
  for (const key of Object.keys(loadedSkills)) {
    delete loadedSkills[key];
  }
  
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skillPath = path.join(SKILLS_DIR, entry.name);
      const skillMdPath = path.join(skillPath, 'SKILL.md');
      
      try {
        const content = await fs.readFile(skillMdPath, 'utf-8');
        const parsed = parseSkillMd(content);
        
        // Scan references and assets
        const referencesDir = path.join(skillPath, 'references');
        const assetsDir = path.join(skillPath, 'assets');
        const scriptsDir = path.join(skillPath, 'scripts');
        
        const references = [];
        const assets = [];
        const scripts = [];
        
        try {
          const files = await fs.readdir(referencesDir);
          references.push(...files);
        } catch (e) {}
        
        try {
          const files = await fs.readdir(assetsDir);
          assets.push(...files);
        } catch (e) {}

        try {
          const files = await fs.readdir(scriptsDir);
          scripts.push(...files);
        } catch (e) {}
        
        loadedSkills[parsed.frontmatter.name] = {
          name: parsed.frontmatter.name,
          frontmatter: parsed.frontmatter,
          instructions: parsed.instructions,
          path: skillPath,
          resources: {
            references,
            assets,
            scripts
          }
        };
      } catch (err) {
        // Skip invalid skill directories silently or log it
        console.warn(`⚠️  Warning: Skipped loading skill in "${entry.name}": ${err.message}`);
      }
    }
  }
  return loadedSkills;
}

/**
 * Loads all custom JS tools/plugins from the plugins/ directory.
 */
export async function loadAllPlugins() {
  await ensureDirsExist();
  const entries = await fs.readdir(PLUGINS_DIR, { withFileTypes: true });
  
  // Clear existing loaded plugins
  for (const key of Object.keys(loadedPlugins)) {
    delete loadedPlugins[key];
  }
  
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.js')) {
      const pluginPath = path.join(PLUGINS_DIR, entry.name);
      try {
        const fileUrl = pathToFileURL(pluginPath).href;
        const module = await import(fileUrl);
        
        // Find exported FunctionTool instances
        const toolsFound = [];
        
        for (const [key, value] of Object.entries(module)) {
          if (value && typeof value === 'object') {
            // Check if it's an instance of FunctionTool or has the proper interface
            if (value instanceof FunctionTool || (value.name && value.description && typeof value.execute === 'function')) {
              toolsFound.push(value);
            } else if (Array.isArray(value)) {
              for (const item of value) {
                if (item instanceof FunctionTool || (item && item.name && item.description && typeof item.execute === 'function')) {
                  toolsFound.push(item);
                }
              }
            }
          }
        }
        
        if (toolsFound.length > 0) {
          loadedPlugins[entry.name] = {
            fileName: entry.name,
            filePath: pluginPath,
            tools: toolsFound
          };
        }
      } catch (err) {
        console.warn(`⚠️  Warning: Skipped loading plugin "${entry.name}": ${err.message}`);
      }
    }
  }
  return loadedPlugins;
}

/**
 * Returns all currently loaded skills.
 */
export function getLoadedSkills() {
  return loadedSkills;
}

/**
 * Returns all currently loaded plugins.
 */
export function getLoadedPlugins() {
  return loadedPlugins;
}

/**
 * Programmatically creates a new skill.
 */
export async function createSkill(name, description, tags, instructions) {
  await ensureDirsExist();
  
  // Validate name
  const namePattern = /^([a-z0-9]+(-[a-z0-9]+)*|[a-z0-9]+(_[a-z0-9]+)*)$/;
  if (!namePattern.test(name)) {
    throw new Error('Skill name must be lowercase kebab-case (a-z, 0-9, hyphens) or snake_case (a-z, 0-9, underscores).');
  }
  
  const skillPath = path.join(SKILLS_DIR, name);
  await fs.mkdir(skillPath, { recursive: true });
  await fs.mkdir(path.join(skillPath, 'references'), { recursive: true });
  await fs.mkdir(path.join(skillPath, 'assets'), { recursive: true });
  await fs.mkdir(path.join(skillPath, 'scripts'), { recursive: true });
  
  const frontmatter = {
    name,
    description,
    tags: Array.isArray(tags) ? tags.join(', ') : tags || ''
  };
  
  const skillMdContent = formatSkillMd(frontmatter, instructions);
  await fs.writeFile(path.join(skillPath, 'SKILL.md'), skillMdContent, 'utf-8');
  
  // Reload skills
  await loadAllSkills();
  return loadedSkills[name];
}

/**
 * Programmatically creates a new plugin.
 */
export async function createPlugin(fileName, codeContent) {
  await ensureDirsExist();
  
  if (!fileName.endsWith('.js')) {
    fileName += '.js';
  }
  
  const pluginPath = path.join(PLUGINS_DIR, fileName);
  await fs.writeFile(pluginPath, codeContent, 'utf-8');
  
  // Reload plugins
  await loadAllPlugins();
  return loadedPlugins[fileName];
}
