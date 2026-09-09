import { ConversationalAgent } from './core/agent.js';
import readline from 'readline';
import 'dotenv/config';

// Initialize agent with enhanced configuration
const agent = new ConversationalAgent({
  memory: true,          // Enable conversation history
  temperature: 0.7,      // Balance creativity vs consistency
  maxTokens: 150        // Limit response length
});

// Create CLI interface with enhanced options
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'You: ',       // Consistent prompt formatting
  terminal: true         // Enable ANSI colors
});

console.log('=== AI Conversational Agent ===');
console.log('Type your message or "exit" to quit\n');

// Enhanced chat loop with error handling
async function chatLoop() {
  try {
    rl.question('You: ', async (input) => {
      if (!input || input.trim() === '') {
        console.log('Agent: Please say something meaningful.\n');
        return chatLoop();
      }

      if (input.toLowerCase() === 'exit') {
        console.log('\nAgent: Goodbye!');
        return rl.close();
      }

      // Show typing indicator
      process.stdout.write('Agent: Thinking...');

      try {
        const response = await agent.chat(input);
        // Clear typing indicator and show response
        process.stdout.clearLine();
        process.stdout.cursorTo(0);
        console.log(`Agent: ${response}\n`);
      } catch (err) {
        console.error('\nAgent: Sorry, I encountered an error.');
        console.error(`Error: ${err.message}`);
      }

      chatLoop();
    });
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
}

// Handle clean exit
rl.on('close', () => {
  console.log('\nSession ended');
  process.exit(0);
});

// Start conversation
chatLoop();