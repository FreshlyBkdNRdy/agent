import { tool } from 'ai';

export class ToolRegistry {
  constructor() {
    this.definitions = new Map();
    this.lastExecutions = [];
  }

  register({ name, description, parameters, execute, enabled = true, approval = 'none' }) {
    if (!name || !description || !parameters || typeof execute !== 'function') {
      throw new Error('A tool requires name, description, parameters, and execute.');
    }

    this.definitions.set(name, {
      name,
      description,
      parameters,
      execute,
      enabled,
      approval
    });
    return this;
  }

  unregister(name) {
    this.definitions.delete(name);
    return this;
  }

  setEnabled(name, enabled) {
    const definition = this.definitions.get(name);
    if (!definition) throw new Error(`Unknown tool: ${name}`);
    definition.enabled = Boolean(enabled);
    return definition;
  }

  list() {
    return [...this.definitions.values()].map(({ name, description, enabled, approval }) => ({
      name,
      description,
      enabled,
      approval
    }));
  }

  getEnabledDefinitions() {
    return [...this.definitions.values()].filter(definition => definition.enabled);
  }

  getEnabledTools() {
    return Object.fromEntries(this.getEnabledDefinitions().map(definition => [
      definition.name,
      tool({
        description: definition.description,
        parameters: definition.parameters,
        execute: async argumentsObject => {
          const startedAt = Date.now();
          try {
            const result = await definition.execute(argumentsObject);
            this.lastExecutions.push({
              name: definition.name,
              status: 'completed',
              durationMs: Date.now() - startedAt,
              result: String(result).slice(0, 500),
              timestamp: new Date().toISOString()
            });
            this.lastExecutions = this.lastExecutions.slice(-20);
            return result;
          } catch (error) {
            this.lastExecutions.push({
              name: definition.name,
              status: 'failed',
              durationMs: Date.now() - startedAt,
              result: error.message,
              timestamp: new Date().toISOString()
            });
            this.lastExecutions = this.lastExecutions.slice(-20);
            throw error;
          }
        }
      })
    ]));
  }

  getRecentExecutions() {
    return [...this.lastExecutions].reverse();
  }
}
