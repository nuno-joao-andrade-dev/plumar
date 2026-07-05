import { filesystemTools } from './filesystem.js';
import { mediaTools } from './media.js';
import { systemTools } from './system.js';
import { webTools } from './web.js';
import { agentTools } from './agent.js';
import { developmentTools } from './development.js';

export const tools = {
  ...filesystemTools,
  ...mediaTools,
  ...systemTools,
  ...webTools,
  ...agentTools,
  ...developmentTools
};
