import express from 'express';
import dotenv from 'dotenv';
import { AgenticSystem } from './agent.js';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
app.use(express.json());

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
const webClientPath = path.resolve(projectDirectory, 'test.html');

// Initialize the agent without MCP server
const agent = new AgenticSystem({
  model: process.env.MODEL?.trim() || 'deepseek-chat',
  allowedDir: './workspace',
  maxSteps: 5
});

// Boot up the agent before starting the server
async function startServer() {
  try {
    console.log('Initializing Agentic System...');
    await agent.initialize();
    console.log('System initialized successfully!');

    app.get('/', (_req, res) => {
      res.sendFile(webClientPath);
    });

    app.get('/health', (_req, res) => {
      res.json({ status: 'online', model: agent.modelName, run: agent.lastRun });
    });

    app.get('/tools', (_req, res) => {
      res.json({ tools: agent.getToolStatus(), executions: agent.getRecentToolExecutions() });
    });

    app.patch('/tools/:name', (req, res) => {
      try {
        const { enabled } = req.body;
        if (typeof enabled !== 'boolean') {
          return res.status(400).json({ error: 'enabled must be a boolean' });
        }
        const toolStatus = agent.setToolEnabled(req.params.name, enabled);
        res.json(toolStatus);
      } catch (error) {
        res.status(404).json({ error: error.message });
      }
    });

    // Chat Endpoint
    app.post('/chat', async (req, res) => {
      const { message, controls = {} } = req.body;
      
      if (!message) {
        return res.status(400).json({ error: 'Message is required' });
      }

      try {
        console.log(`Processing message: ${message}`);
        const response = await agent.execute(message, controls);
        res.json({
          response,
          run: agent.lastRun,
          executions: agent.getRecentToolExecutions()
        });
      } catch (error) {
        console.error('Agent execution error:', error);
        res.status(500).json({ error: 'Failed to process message' });
      }
    });

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(` Server running on http://localhost:${PORT}`);
      console.log(`💬 Send POST requests to http://localhost:${PORT}/chat`);
    });

  } catch (error) {
    console.error('Failed to initialize system:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  await agent.cleanup();
  process.exit(0);
});

startServer();