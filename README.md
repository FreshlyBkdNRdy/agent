# Conversational Agent

A chatbot agent with conversation memory and context-aware responses.

## 🚀 Quick Start

1. `npm install`
2. `cp .env.example .env` (add your API key)
3. `npm start` (demo mode)
4. `npm run chat` (interactive mode)

## 📁 Structure

```
src/
├── core/
│   ├── agent.js      # Main conversational agent
│   └── memory.js     # Memory management
├── config/
│   └── prompts.js    # System prompts
├── index.js          # Demo entry
└── cli.js            # Interactive chat
```

## ✨ Features

- Conversation memory with configurable history length
- Context-aware responses
- Personality customization
- CLI interface for real-time interaction

---