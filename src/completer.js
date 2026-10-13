import fs from 'fs';
import path from 'path';

export const DEFAULT_SLASH_COMMANDS = [
  '/help',
  '/info',
  '/status',
  '/settings',
  '/model',
  '/mode',
  '/chat-mode',
  '/temperature',
  '/temp',
  '/host',
  '/endpoint',
  '/provider',
  '/api-key',
  '/apikey',
  '/policy',
  '/processes',
  '/ps',
  '/sessions',
  '/minimize',
  '/refeed',
  '/execute-thinking',
  '/thinking-execute',
  '/adk-info',
  '/json',
  '/skills',
  '/plugins',
  '/mcp',
  '/dino-game',
  '/features',
  '/clear',
  '/new',
  '/reset',
  '/exit',
  '/quit'
];

export const CHAT_MODE_KEYS = [
  'balanced',
  'coder',
  'architect',
  'creative',
  'concise',
  'agent',
  'fast'
];

export const POLICY_LEVELS = ['allow', 'ask', 'deny', 'reset'];

/**
 * Creates a readline completer function supporting:
 * 1. Slash commands (`/help`, `/policy`, `/processes`, etc.)
 * 2. Sub-arguments for `/policy <tool> <allow|ask|deny>`, `/mode <mode>`, `/execute-thinking <on|off|run|direct>`
 * 3. `@file` workspace path completion
 */
export function createCliCompleter({
  slashCommands = DEFAULT_SLASH_COMMANDS,
  getToolNames = () => [],
  getWorkspaceDir = () => process.cwd()
} = {}) {
  return function completer(line) {
    if (typeof line !== 'string') {
      return [[], line];
    }

    const trimmedStart = line.trimStart();

    // 1. Slash command completion
    if (trimmedStart.startsWith('/')) {
      const parts = trimmedStart.split(/\s+/);

      // Completing the primary slash command
      if (parts.length === 1 && !trimmedStart.endsWith(' ')) {
        const prefix = parts[0].toLowerCase();
        const hits = slashCommands.filter((cmd) => cmd.startsWith(prefix));
        return [hits.length ? hits : slashCommands, parts[0]];
      }

      const cmd = parts[0].toLowerCase();

      // Completing `/policy <toolName>` or `/policy <toolName> <level>`
      if (cmd === '/policy') {
        const toolNames = getToolNames();
        if (parts.length === 2 && !trimmedStart.endsWith(' ')) {
          const partialTool = parts[1];
          const candidates = ['reset', ...toolNames];
          const hits = candidates.filter((t) => t.toLowerCase().startsWith(partialTool.toLowerCase()));
          return [hits, partialTool];
        }
        if ((parts.length === 2 && trimmedStart.endsWith(' ')) || (parts.length === 3 && !trimmedStart.endsWith(' '))) {
          const partialLevel = parts[2] || '';
          const hits = POLICY_LEVELS.filter((lvl) => lvl.startsWith(partialLevel.toLowerCase()));
          return [hits, partialLevel];
        }
      }

      // Completing `/mode <modeKey>` or `/chat-mode <modeKey>`
      if (cmd === '/mode' || cmd === '/chat-mode') {
        const partialMode = (parts.length === 2 && !trimmedStart.endsWith(' ')) ? parts[1] : '';
        const hits = CHAT_MODE_KEYS.filter((m) => m.startsWith(partialMode.toLowerCase()));
        return [hits, partialMode];
      }

      // Completing `/execute-thinking <subcmd>`
      if (cmd === '/execute-thinking' || cmd === '/thinking-execute') {
        const subCmds = ['on', 'off', 'run', 'direct'];
        const partial = (parts.length === 2 && !trimmedStart.endsWith(' ')) ? parts[1] : '';
        const hits = subCmds.filter((s) => s.startsWith(partial.toLowerCase()));
        return [hits, partial];
      }

      return [[], line];
    }

    // 2. `@file` path completion anywhere in the prompt
    const atMatch = line.match(/(?:^|\s)@([^\s]*)$/);
    if (atMatch) {
      const rawPartial = atMatch[1] || '';
      const tokenWithAt = `@${rawPartial}`;
      try {
        const workspaceDir = getWorkspaceDir();
        const lastSlashIdx = rawPartial.lastIndexOf('/');
        const relDir = lastSlashIdx >= 0 ? rawPartial.slice(0, lastSlashIdx + 1) : '';
        const filePrefix = lastSlashIdx >= 0 ? rawPartial.slice(lastSlashIdx + 1) : rawPartial;
        const targetDir = path.resolve(workspaceDir, relDir || '.');

        if (!targetDir.startsWith(workspaceDir)) {
          return [[], tokenWithAt];
        }

        const entries = fs.readdirSync(targetDir, { withFileTypes: true });
        const ignored = new Set(['node_modules', '.git', '.antigravitycli']);
        const hits = [];
        for (const entry of entries) {
          if (ignored.has(entry.name)) continue;
          if (entry.name.startsWith(filePrefix)) {
            const suffix = entry.isDirectory() ? '/' : '';
            hits.push(`@${relDir}${entry.name}${suffix}`);
          }
        }
        return [hits, tokenWithAt];
      } catch {
        return [[], tokenWithAt];
      }
    }

    return [[], line];
  };
}
