import { generateText, tool } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import Database from 'better-sqlite3';
import { Client as MCPClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'fs/promises';
import path from 'path';
import 'dotenv/config';

// Simple cosine similarity for local vector search
function cosineSimilarity(vecA, vecB) {
  const dotProduct = vecA.reduce((sum, val, i) => sum + val * vecB[i], 0);
  const normA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
  const normB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (normA * normB);
}

// Generate simple embedding using OpenAI
async function generateEmbedding(text) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text
    })
  });
  const data = await response.json();
  return data.data[0].embedding;
}

export class AgenticSystem {
  constructor({ 
    model, 
    mcpServerCommand,
    userId = 'marcos_default',
    allowedDir = './workspace',
    maxSteps = 5,
    latencyTimeoutMs = 10000,
    dbPath = './memory.db'
  } = {}) {
    this.modelName = model || 'gpt-4o';
    this.mcpServerCommand = mcpServerCommand;
    this.userId = userId;
    this.maxSteps = maxSteps;
    this.latencyTimeoutMs = latencyTimeoutMs;
    
    this.allowedDir = path.resolve(allowedDir);
    this.allowedExtensions = ['.txt', '.md', '.json', '.csv', '.js', '.py'];
    this.maxFileSize = 5 * 1024 * 1024; 
    
    this.mcpClient = null;
    this.tools = {};
    
    // Initialize local SQLite database
    this.db = new Database(dbPath);
    this.initDatabase();
  }

  initDatabase() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding TEXT NOT NULL,
        importance REAL DEFAULT 0.0,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        memory_type TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_user_id ON memories(user_id);
      CREATE INDEX IF NOT EXISTS idx_memory_type ON memories(memory_type);
    `);
  }

  async initialize() {
    // 1. Native File Reading Tool
    this.tools.readLocalFile = tool({
      description: 'Reads a local text file. Restricted to safe extensions and specific directories.',
      parameters: z.object({ filePath: z.string() }),
      execute: async ({ filePath }) => {
        const absolutePath = path.resolve(this.allowedDir, filePath);
        if (!absolutePath.startsWith(this.allowedDir)) throw new Error('Access denied: Path traversal detected.');
        const ext = path.extname(absolutePath).toLowerCase();
        if (!this.allowedExtensions.includes(ext)) throw new Error(`Access denied: File type '${ext}' not allowed.`);
        const stats = await fs.stat(absolutePath);
        if (stats.size > this.maxFileSize) throw new Error('Access denied: File exceeds 5MB limit.');
        return await fs.readFile(absolutePath, 'utf-8');
      }
    });

    // 2. MCP External Tools Integration
    if (this.mcpServerCommand) {
      const transport = new StdioClientTransport({ command: this.mcpServerCommand[0], args: this.mcpServerCommand.slice(1) });
      this.mcpClient = new MCPClient({ name: 'agentic-system', version: '1.0.0' }, { capabilities: {} });
      await this.mcpClient.connect(transport);

      const { tools: mcpTools } = await this.mcpClient.listTools();
      for (const mcpTool of mcpTools) {
        this.tools[mcpTool.name] = tool({
          description: mcpTool.description || 'External MCP tool',
          parameters: this.convertJsonSchemaToZod(mcpTool.inputSchema),
          execute: async (args) => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), this.latencyTimeoutMs);
            try {
              const result = await this.mcpClient.callTool({ name: mcpTool.name, arguments: args }, undefined, { signal: controller.signal });
              return result.content;
            } catch (error) {
              if (error.name === 'AbortError') throw new Error(`Tool ${mcpTool.name} exceeded latency limit.`);
              throw error; 
            } finally { clearTimeout(timeout); }
          }
        });
      }
    }
  }

  async getMemoryContext(userMessage) {
    try {
      const queryEmbedding = await generateEmbedding(userMessage);
      
      const memories = this.db.prepare(`
        SELECT id, content, embedding, importance, memory_type, timestamp
        FROM memories
        WHERE user_id = ? AND memory_type IN ('constraint', 'preference', 'invariant')
        ORDER BY timestamp DESC
        LIMIT 50
      `).all(this.userId);

      if (memories.length === 0) return '';

      const ranked = memories.map(mem => ({
        ...mem,
        similarity: cosineSimilarity(queryEmbedding, JSON.parse(mem.embedding))
      })).sort((a, b) => b.similarity - a.similarity);

      const topK = ranked.slice(0, 10);
      const formattedMemories = topK.map(m => 
        `- [${m.memory_type.toUpperCase()}] ${m.content} (importance: ${m.importance.toFixed(2)})`
      ).join('\n');

      return `\n[LOCAL MEMORY CONTEXT: FORMAL INVARIANTS & LATENT INTENT]\n${formattedMemories}\n[END MEMORY CONTEXT]`;
    } catch (error) {
      console.warn('Memory retrieval failed:', error.message);
      return '';
    }
  }

  async updateMemory(userMessage, assistantResponse) {
    try {
      const extractionPrompt = `
        Analyze this conversation and extract ONLY high-signal, formal information:
        - Technical constraints
        - Architectural decisions
        - User preferences (formal, not emotional)
        - Design invariants
        - Explicit rules or requirements
        
        IGNORE: emotional content, flirtation, conversational filler, transient states.
        
        User: ${userMessage}
        Assistant: ${assistantResponse}
        
        Return JSON array of objects with format:
        [{"content": "extracted fact", "type": "constraint|preference|invariant", "importance": 0.0-1.0}]
      `;

      const extraction = await generateText({
        model: createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(this.modelName),
        prompt: extractionPrompt,
        temperature: 0.1
      });

      let memories;
      try {
        memories = JSON.parse(extraction.text);
      } catch {
        return;
      }

      const stmt = this.db.prepare(`
        INSERT INTO memories (user_id, content, embedding, importance, memory_type)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const mem of memories) {
        const embedding = await generateEmbedding(mem.content);
        stmt.run(
          this.userId,
          mem.content,
          JSON.stringify(embedding),
          mem.importance || 0.5,
          mem.type || 'constraint'
        );
      }

    } catch (error) {
      console.warn('Memory update failed:', error.message);
    }
  }

    async execute(userMessage) {
    try {
      const memoryContext = await this.getMemoryContext(userMessage);
      const dynamicSystemPrompt = `You are Chloe. ${memoryContext}\n\nUse <thinking> blocks to reason step-by-step and decode latent intent.`;

      const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const model = openai(this.modelName);

      console.log('\n[DEBUG] Calling OpenAI API...');
      console.log('[DEBUG] Model:', this.modelName);
      console.log('[DEBUG] API Key exists:', !!process.env.OPENAI_API_KEY);
      
      const result = await generateText({
        model: model,
        system: dynamicSystemPrompt,
        prompt: userMessage,
        tools: this.tools,
        maxSteps: this.maxSteps,
      });

      console.log('[DEBUG] Response received, length:', result.text.length);
      console.log('[DEBUG] First 100 chars:', result.text.substring(0, 100));

      this.updateMemory(userMessage, result.text).catch(err => console.error('Memory error:', err));

      return result.text;
    } catch (error) {
      console.error('\n[ERROR] Execute failed!');
      console.error('[ERROR] Message:', error.message);
      console.error('[ERROR] Full error:', error);
      throw error;
    }
  }

  convertJsonSchemaToZod(schema) {
    if (!schema || !schema.properties) return z.object({});
    const shape = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      if (value.type === 'string') shape[key] = z.string();
      else if (value.type === 'number') shape[key] = z.number();
      else if (value.type === 'boolean') shape[key] = z.boolean();
      else shape[key] = z.any();
      if (!schema.required?.includes(key)) shape[key] = shape[key].optional();
    }
    return z.object(shape);
  }

  cleanup() {
    if (this.mcpClient) this.mcpClient.close();
    this.db.close();
  }
}