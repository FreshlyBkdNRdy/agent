import express from 'express';
import dotenv from 'dotenv';
import { AgenticSystem } from './core/agent.js';

dotenv.config();

const app = express();
app.use(express.json());

// Initialize the Agentic System
const agent = new AgenticSystem({
  model: 'gpt-4o',
  mcpServerCommand: ['node', 'mcp-server.js'],
  allowedDir: './workspace',
  maxSteps: 5,
  latencyTimeoutMs: 10000
});

// Boot up the agent and MCP connections before starting the server
async function startServer() {
  try {
    console.log('Initializing Agentic System and MCP connections...');
    await agent.initialize();
    console.log('System initialized successfully!');

    // Chat Endpoint
    app.post('/chat', async (req, res) => {
      const { message } = req.body;
      
      if (!message) {
        return res.status(400).json({ error: 'Message is required' });
      }

      try {
        console.log(`Processing message: ${message}`);
        const response = await agent.execute(message);
        res.json({ response });
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