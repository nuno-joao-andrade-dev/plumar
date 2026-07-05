import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import { getLoadedSkills, createSkill as createSkillInManager, createPlugin as createPluginInManager } from '../skills-plugins-manager.js';

export const agentTools = {
  listSkills: new FunctionTool({
    name: 'listSkills',
    description: 'List all custom agentic skills currently loaded in the workspace.',
    parameters: z.object({}),
    execute: async () => {
      try {
        const skills = getLoadedSkills();
        return {
          success: true,
          skills: Object.values(skills).map(s => ({
            name: s.name,
            description: s.frontmatter.description,
            tags: s.frontmatter.tags,
            resources: s.resources
          }))
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }),

  loadSkill: new FunctionTool({
    name: 'loadSkill',
    description: 'Read the detailed instructions, assets, references, and scripts of a loaded custom skill.',
    parameters: z.object({
      name: z.string().describe('The name of the skill to load (must match a loaded skill name).')
    }),
    execute: async ({ name }) => {
      try {
        const skills = getLoadedSkills();
        const skill = skills[name];
        if (!skill) {
          return {
            success: false,
            error: `Skill "${name}" not found. Use "listSkills" to see available skills.`
          };
        }
        return {
          success: true,
          name: skill.name,
          description: skill.frontmatter.description,
          instructions: skill.instructions,
          resources: skill.resources
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }),

  createSkill: new FunctionTool({
    name: 'createSkill',
    description: 'Create a new custom skill folder with its SKILL.md file and references/assets/scripts directories.',
    parameters: z.object({
      name: z.string().describe('Name of the skill in lowercase kebab-case or snake_case.'),
      description: z.string().describe('Short description of what this skill does.'),
      tags: z.array(z.string()).optional().describe('List of tags/keywords associated with this skill.'),
      instructions: z.string().describe('Detailed markdown instructions for the skill.')
    }),
    execute: async ({ name, description, tags, instructions }) => {
      try {
        const skill = await createSkillInManager(name, description, tags, instructions);
        return {
          success: true,
          message: `Skill "${name}" created successfully at ${skill.path}.`,
          skill: {
            name: skill.name,
            description: skill.frontmatter.description,
            tags: skill.frontmatter.tags
          }
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }),

  createPlugin: new FunctionTool({
    name: 'createPlugin',
    description: 'Create a new custom JavaScript plugin (FunctionTool) to extend the agent\'s capabilities.',
    parameters: z.object({
      fileName: z.string().describe('Name of the JavaScript file to create (e.g., "my-tool.js" or "my-tool").'),
      codeContent: z.string().describe('The complete ESM JavaScript code exporting a FunctionTool or array of tools.')
    }),
    execute: async ({ fileName, codeContent }) => {
      try {
        const plugin = await createPluginInManager(fileName, codeContent);
        return {
          success: true,
          message: `Plugin "${fileName}" created successfully. It will be loaded on the next startup.`,
          plugin: {
            fileName: plugin.fileName,
            filePath: plugin.filePath
          }
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }),
};
