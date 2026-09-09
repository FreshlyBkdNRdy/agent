# Chloe

Chloe is a conversational agent powered by DeepSeek. It includes a browser chat studio, conversation memory, local file tools, and adjustable response controls.

## Start Chloe

From this folder:

```powershell
npm install
copy .env.example .env
```

Open `.env` and replace the placeholder value with your DeepSeek API key:

```env
DEEPSEEK_API_KEY=your_real_deepseek_key
MODEL=deepseek-chat
```

Start the web server:

```powershell
npm start
```

Then open [http://localhost:3000](http://localhost:3000) in your browser. The web interface is served by the same server, so do not open `test.html` directly from the file system.

For development with automatic server restarts:

```powershell
npm run dev
```

## Web controls

The browser studio provides:

- Persistent chat history in the browser
- New conversation control
- Open, Focus, Spark, and Grill conversation modes
- Imagination and response-depth sliders
- Starter prompts
- Server health status at `/health`

## Project layout

```text
agent.js       Agent logic, memory, and autonomous multi-step execution
tool-registry.js  Plug-in registry for Chloe tools
server.js      Express server, `/chat`, and tool control APIs
index.js       Terminal chat client
cli.js         Alternate terminal client
prompts.js     Chloe system prompt
test.html      Browser chat studio served at `/`
.env.example   Environment variable template
```

## API

### `GET /health`

Returns the server status and configured model.

### `POST /chat`

Send a message:

```json
{
  "message": "Help me plan this project",
  "controls": {
    "temperature": 0.7,
    "maxTokens": 300
  }
}
```

## Troubleshooting

- **Chloe cannot answer:** confirm `.env` contains a valid `DEEPSEEK_API_KEY`, then restart the server.
- **The page does not load:** confirm the terminal shows `Server running on http://localhost:3000` and use that exact URL.
- **Port 3000 is busy:** start with another port in PowerShell: `$env:PORT=3001; npm start`, then open `http://localhost:3001`.

## Tools and autonomous work

Tools are registered in `agent.js` through `registerTool()`. A tool provides a name, description, Zod input schema, and `execute()` function:

```js
agent.registerTool({
  name: 'myTool',
  description: 'Does one useful thing',
  parameters: z.object({ value: z.string() }),
  execute: async ({ value }) => `Result: ${value}`
});
```

When Chloe receives a job, DeepSeek can choose an enabled tool. The agent executes the tool, gives the result back to the model, and continues for up to the configured number of steps. The browser can enable or disable registered tools from the **Installed tools** panel.

The tool API is also available directly:

- `GET /tools` lists installed tools and recent executions.
- `PATCH /tools/:name` with `{ "enabled": true }` enables or disables a registered tool.
