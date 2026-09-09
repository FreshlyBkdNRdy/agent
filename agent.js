import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import initSqlJs from 'sql.js';
import fs from 'fs/promises';
import path from 'path';
import 'dotenv/config';
import { systemPrompt as chloeSystemPrompt } from './prompts.js';
import { ToolRegistry } from './tool-registry.js';

// Simple cosine similarity for local vector search
function cosineSimilarity(vecA, vecB) {
  const dotProduct = vecA.reduce((sum, val, i) => sum + val * vecB[i], 0);
  const normA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
  const normB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (normA * normB);
}

// Generate a deterministic local embedding for memory similarity.
async function generateEmbedding(text) {
  const embedding = Array(128).fill(0);
  for (const token of text.toLowerCase().match(/[a-z0-9]+/g) || []) {
    let hash = 0;
    for (const character of token) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    embedding[hash % embedding.length] += 1;
  }
  return embedding;
}

export class AgenticSystem {
  constructor({ 
    model, 
    userId = 'marcos_default',
    allowedDir = './workspace',
    maxSteps = 5,
    dbPath = './memory.db'
  } = {}) {
    this.modelName = model || 'deepseek-chat';
    this.userId = userId;
    this.maxSteps = maxSteps;
    
    this.allowedDir = path.resolve(allowedDir);
    this.allowedExtensions = ['.txt', '.md', '.json', '.csv', '.js', '.py'];
    this.maxFileSize = 5 * 1024 * 1024; 
    
    this.toolRegistry = new ToolRegistry();
    this.lastRun = null;
    this.dbPath = dbPath;
    this.db = null;
  }

  async initDatabase() {
    const SQL = await initSqlJs();
    this.db = new SQL.Database();
    this.db.run(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding TEXT NOT NULL,
        importance REAL DEFAULT 0.0,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        memory_type TEXT NOT NULL
      )
    `);
  }

  async initialize() {
    await this.initDatabase();

    this.registerTool({
      name: 'readLocalFile',
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

    this.registerTool({
      name: 'listWorkspaceFiles',
      description: 'Lists files in the permitted workspace directory.',
      parameters: z.object({ subdirectory: z.string().optional() }),
      execute: async ({ subdirectory = '' }) => {
        const directory = path.resolve(this.allowedDir, subdirectory);
        if (!directory.startsWith(this.allowedDir)) throw new Error('Access denied: Path traversal detected.');
        const entries = await fs.readdir(directory, { withFileTypes: true });
        return entries.map(entry => `${entry.isDirectory() ? '[dir] ' : ''}${entry.name}`).join('\n');
      }
    });
  }

  registerTool(definition) {
    this.toolRegistry.register(definition);
    return this;
  }

  setToolEnabled(name, enabled) {
    return this.toolRegistry.setEnabled(name, enabled);
  }

  getToolStatus() {
    return this.toolRegistry.list();
  }

  getRecentToolExecutions() {
    return this.toolRegistry.getRecentExecutions();
  }

  async getMemoryContext(userMessage) {
    try {
      if (!this.db) return '';
      
      const queryEmbedding = await generateEmbedding(userMessage);
      
      const stmt = this.db.prepare(`
        SELECT id, content, embedding, importance, memory_type, timestamp
        FROM memories
        WHERE user_id = ? AND memory_type IN ('constraint', 'preference', 'invariant')
        ORDER BY timestamp DESC
        LIMIT 50
      `);
      stmt.bind([this.userId]);
      const memories = [];
      while (stmt.step()) memories.push(stmt.getAsObject());
      stmt.free();

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
        model: createOpenAI({
          apiKey: process.env.DEEPSEEK_API_KEY,
          baseURL: 'https://api.deepseek.com'
        })(this.modelName),
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

  async execute(userMessage, controls = {}) {
    try {
      const memoryContext = await this.getMemoryContext(userMessage);
      // Use the full Chloe persona from prompts.js, augmented with memory context
      const dynamicSystemPrompt = `${chloeSystemPrompt}${memoryContext ? '\n\n' + memoryContext : ''}`;

      const deepseek = createOpenAI({
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseURL: 'https://api.deepseek.com'
      });
      const model = deepseek(this.modelName);
      const maxSteps = Number.isFinite(Number(controls.maxSteps))
        ? Math.min(20, Math.max(1, Number(controls.maxSteps)))
        : this.maxSteps;

      this.lastRun = {
        status: 'working',
        startedAt: new Date().toISOString(),
        steps: 0,
        maxSteps
      };

      console.log('\n[DEBUG] Calling DeepSeek API...');
      console.log('[DEBUG] Model:', this.modelName);
      console.log('[DEBUG] API Key exists:', !!process.env.DEEPSEEK_API_KEY);
      
      const result = await generateText({
        model: model,
        system: dynamicSystemPrompt,
        prompt: userMessage,
        tools: this.toolRegistry.getEnabledTools(),
        maxSteps,
        onStepFinish: step => {
          this.lastRun.steps += 1;
          this.lastRun.lastStep = step.finishReason;
        },
        temperature: Number.isFinite(Number(controls.temperature))
          ? Math.min(1, Math.max(0, Number(controls.temperature)))
          : 0.7,
        maxTokens: Number.isFinite(Number(controls.maxTokens))
          ? Math.min(600, Math.max(80, Number(controls.maxTokens)))
          : 300,
      });

      console.log('[DEBUG] Response received, length:', result.text.length);
      console.log('[DEBUG] First 100 chars:', result.text.substring(0, 100));

      this.lastRun = {
        ...this.lastRun,
        status: 'completed',
        finishedAt: new Date().toISOString(),
        steps: result.steps?.length || this.lastRun.steps,
        finishReason: result.finishReason
      };

      this.updateMemory(userMessage, result.text).catch(err => console.error('Memory error:', err));

      return result.text;
    } catch (error) {
      console.error('\n[ERROR] Execute failed!');
      console.error('[ERROR] Message:', error.message);
      console.error('[ERROR] Full error:', error);
      this.lastRun = {
        ...this.lastRun,
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: error.message
      };
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
    this.db?.close();
  }
}