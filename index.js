import { AgenticSystem } from './agent.js';
import 'dotenv/config';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'node:process';

// Initialize the agent without MCP server
const agent = new AgenticSystem({
  model: process.env.MODEL?.trim() || 'gpt-4o',
  allowedDir: './workspace',
  maxSteps: 5
});

async function interactiveChat() {
  try {
    console.log('🔮 Booting up Chloe...');
    await agent.initialize();
    console.log('✨ System ready. Type "exit" to quit.\n');

    const rl = readline.createInterface({ input, output });

    while (true) {
      const userInput = await rl.question('\x1b[32mYou:\x1b[0m ');
      
      if (userInput.toLowerCase() === 'exit') break;
      if (!userInput.trim()) continue;

      console.log('\x1b[36mChloe is thinking...\x1b[0m');
      
      try {
        const response = await agent.execute(userInput);
        console.log(`\x1b[35mChloe:\x1b[0m ${response}\n`);
      } catch (err) {
        console.error('\x1b[31mError:\x1b[0m', err.message);
        console.log('Check your OPENAI_API_KEY in .env file!\n');
      }
    }

    await agent.cleanup();
    rl.close();
    console.log('\n💫 Session ended. See you soon!');
    
  } catch (err) {
    console.error('Fatal error:', err);
    await agent.cleanup();
  }
}

interactiveChat();