import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { FunctionTool } from '@google/adk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BUILTIN_SKILLS_DIR = path.resolve(__dirname, '..', 'skills');
const WORKSPACE_DIR = process.cwd();
const SKILLS_DIR = path.join(WORKSPACE_DIR, 'skills');
const PLUGINS_DIR = path.join(WORKSPACE_DIR, 'plugins');

// In-memory cache
const loadedSkills = {};
const loadedPlugins = {};
let skillsInitialized = false;

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
    content += `${key}: "${String(value).replace(/"/g, '\\"')}"\n`;
  }
  content += '---\n\n';
  content += instructions;
  return content;
}

function getSkillDirectories() {
  const dirs = [BUILTIN_SKILLS_DIR];
  const currentWorkspaceSkills = path.join(process.cwd(), 'skills');
  if (path.resolve(currentWorkspaceSkills) !== path.resolve(BUILTIN_SKILLS_DIR)) {
    dirs.push(currentWorkspaceSkills);
  }
  return dirs;
}

/**
 * Synchronously loads skills into memory if not yet initialized.
 */
export function loadAllSkillsSync() {
  for (const key of Object.keys(loadedSkills)) {
    delete loadedSkills[key];
  }

  for (const baseDir of getSkillDirectories()) {
    let entries = [];
    try {
      entries = fsSync.readdirSync(baseDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = path.join(baseDir, entry.name);
        const skillMdPath = path.join(skillPath, 'SKILL.md');
        try {
          const content = fsSync.readFileSync(skillMdPath, 'utf-8');
          const parsed = parseSkillMd(content);

          const references = [];
          const assets = [];
          const scripts = [];
          try { references.push(...fsSync.readdirSync(path.join(skillPath, 'references'))); } catch {}
          try { assets.push(...fsSync.readdirSync(path.join(skillPath, 'assets'))); } catch {}
          try { scripts.push(...fsSync.readdirSync(path.join(skillPath, 'scripts'))); } catch {}

          loadedSkills[parsed.frontmatter.name] = {
            name: parsed.frontmatter.name,
            frontmatter: parsed.frontmatter,
            instructions: parsed.instructions,
            path: skillPath,
            resources: { references, assets, scripts }
          };
        } catch {
          // Ignore invalid skill directories during sync load
        }
      }
    }
  }
  skillsInitialized = true;
  return loadedSkills;
}

/**
 * Loads all skills from the built-in and workspace skills/ directories.
 */
export async function loadAllSkills() {
  await ensureDirsExist();

  // Clear existing loaded skills
  for (const key of Object.keys(loadedSkills)) {
    delete loadedSkills[key];
  }

  for (const baseDir of getSkillDirectories()) {
    let entries = [];
    try {
      entries = await fs.readdir(baseDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = path.join(baseDir, entry.name);
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
          console.warn(`Warning: Skipped loading skill in "${entry.name}": ${err.message}`);
        }
      }
    }
  }
  skillsInitialized = true;
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
        console.warn(`Warning: Skipped loading plugin "${entry.name}": ${err.message}`);
      }
    }
  }
  return loadedPlugins;
}

/**
 * Returns all currently loaded skills (auto-initializing synchronously if needed).
 */
export function getLoadedSkills() {
  if (!skillsInitialized && Object.keys(loadedSkills).length === 0) {
    loadAllSkillsSync();
  }
  return loadedSkills;
}

/**
 * Finds a loaded skill by exact name, case-insensitive name, or matching tag/keyword.
 */
export function findSkillByNameOrKeyword(query) {
  if (!query || typeof query !== 'string') return null;
  const skills = getLoadedSkills();
  const trimmed = query.trim();
  if (skills[trimmed]) return skills[trimmed];

  const normalized = trimmed.toLowerCase().replace(/[\s_]+/g, '-');
  if (skills[normalized]) return skills[normalized];

  // Partial name or tag match
  for (const skill of Object.values(skills)) {
    const sName = skill.name.toLowerCase();
    if (sName.includes(normalized) || normalized.includes(sName)) {
      return skill;
    }
    const tags = (skill.frontmatter.tags || '')
      .toLowerCase()
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
    if (tags.includes(trimmed.toLowerCase()) || tags.includes(normalized)) {
      return skill;
    }
  }
  return null;
}

/**
 * Automatically detects relevant technology skills based on the user's prompt
 * and workspace project files (e.g. package.json, angular.json, requirements.txt, go.mod, Cargo.toml, etc.).
 */
export function detectRelevantTechSkills(userMessage = '', cwd = process.cwd(), maxSkills = 2) {
  const skills = getLoadedSkills();
  if (Object.keys(skills).length === 0) return [];

  const promptText = String(userMessage || '').toLowerCase();
  const scores = new Map();
  const addScore = (skillName, points) => {
    if (skills[skillName]) {
      scores.set(skillName, (scores.get(skillName) || 0) + points);
    }
  };

  // 1. Prompt-based intent scoring (highest priority)
  if (/\b(?:react|vite|angular|vue|express|fastify|node\.?js|next\.?js|frontend|backend|full[-\s]?stack|html|css|typescript|javascript|rest\s*api|cors|proxy)\b/i.test(promptText)) {
    addScore('fullstack-web-node', 10);
  }
  if (/\b(?:python|python3|fastapi|flask|django|uvicorn|pytest|pip|venv|virtualenv|pydantic|\w+\.py)\b/i.test(promptText)) {
    addScore('python-development', 10);
  }
  if (/\b(?:sql|postgres|postgresql|mysql|sqlite|database|schema|migration|dbexplorer|query\s+table)\b/i.test(promptText)) {
    addScore('database-sql', 10);
  }
  if (/\b(?:debug|debugging|failing\s+test|unit\s+test|load\s+test|benchmark|docker|dockerfile|docker-compose|port\s+in\s+use|eaddrinuse|git\s+commit|lint)\b/i.test(promptText)) {
    addScore('testing-debugging-devops', 9);
  }
  if (/\b(?:golang|go\.mod|go\s+(?:mod|build|run|test)|goroutines?|in\s+go|rust|rustc|cargo(?:\.toml)?|c\+\+|cpp|cmake|cmakelists|makefile|gcc|g\+\+|clang|java|maven|gradle|pom\.xml|spring\s*boot|\w+\.(?:rs|go|cpp|cc|java))\b/i.test(promptText)) {
    addScore('systems-compiled-languages', 10);
  }

  // Also check custom skills by name or tag mentions in the user prompt
  for (const [name, skill] of Object.entries(skills)) {
    if (promptText.includes(name.toLowerCase())) {
      addScore(name, 12);
    }
  }

  // 2. Workspace marker file scoring (inspects cwd and common 1-level project subdirectories)
  const checkDirs = [cwd, 'backend', 'frontend', 'server', 'client', 'api'].map(d =>
    d === cwd ? cwd : path.join(cwd, d)
  );
  const existsInWorkspace = (fileName) => {
    for (const dir of checkDirs) {
      try {
        if (fsSync.existsSync(path.join(dir, fileName))) return true;
      } catch {}
    }
    return false;
  };

  if (existsInWorkspace('angular.json') || existsInWorkspace('vite.config.js') || existsInWorkspace('vite.config.ts') || existsInWorkspace('index.html')) {
    addScore('fullstack-web-node', 4);
  } else if (existsInWorkspace('package.json') && promptText.length > 0) {
    addScore('fullstack-web-node', 2);
  }

  if (existsInWorkspace('requirements.txt') || existsInWorkspace('pyproject.toml') || existsInWorkspace('Pipfile') || existsInWorkspace('manage.py')) {
    addScore('python-development', 5);
  }

  if (existsInWorkspace('schema.sql') || existsInWorkspace('init.sql')) {
    addScore('database-sql', 5);
  }

  if (existsInWorkspace('Dockerfile') || existsInWorkspace('docker-compose.yml') || existsInWorkspace('docker-compose.yaml')) {
    addScore('testing-debugging-devops', 4);
  }

  if (existsInWorkspace('go.mod') || existsInWorkspace('Cargo.toml') || existsInWorkspace('CMakeLists.txt') || existsInWorkspace('pom.xml') || existsInWorkspace('build.gradle')) {
    addScore('systems-compiled-languages', 5);
  }

  return Array.from(scores.entries())
    .filter(([, score]) => score >= 4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxSkills)
    .map(([name]) => skills[name]);
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
