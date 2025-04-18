# Otter.ai Plugin for Eliza AI Framework

This plugin integrates Otter.ai functionality into the Eliza AI agent framework, allowing your agent to access and manage transcripts and meeting summaries from Otter.ai.

## Features

- **Transcript Retrieval**: Fetch and display transcripts from your Otter.ai account
- **Meeting Summary Access**: Access AI-generated summaries of your Otter.ai meetings
- **Search Functionality**: Search through transcripts for specific content
- **Context Provider**: Adds recent transcript information to the agent's context

## Prerequisites

- Node.js 14.x or higher
- A valid Otter.ai account

## Installation

1. Install the plugin in your Eliza AI agent project:

```bash
npm install eliza-plugin-otter
```

2. Add the plugin to your agent's configuration file:

```json
{
  "plugins": [
    "eliza-plugin-otter"
  ],
  "settings": {
    "OTTER_EMAIL": "your-email@example.com",
    "OTTER_PASSWORD": "your-password"
  }
}
```

## Usage

Once installed and configured, the plugin provides the following capabilities to your Eliza agent:

### Actions

1. **FETCH_OTTER_TRANSCRIPTS**: Retrieve transcripts from Otter.ai
   - List recent transcripts: "Show me my Otter.ai transcripts"
   - Get a specific transcript: "Get transcript for [ID]"
   - Search transcripts: "Search for [query] in my transcripts"

2. **FETCH_OTTER_SUMMARY**: Retrieve meeting summaries from Otter.ai
   - List recent summaries: "Show me my Otter.ai meeting summaries"
   - Get a specific summary: "Get summary for [ID]"

### Context Provider

The plugin also includes a context provider that adds information about your recent Otter.ai transcripts to the agent's state, allowing it to reference your recent meetings when relevant to the conversation.

## Development

### Project Structure

```
├── actions
│   ├── fetchTranscripts.ts
│   ├── fetchMeetingSummary.ts
│   └── index.ts
├── constants.ts
├── index.ts
├── providers
│   ├── otterContextProvider.ts
│   └── index.ts
├── routes
│   ├── health.ts
│   └── index.ts
└── services
    ├── index.ts
    └── otterApi.ts
```

### Building

```bash
npm run build
```

## Security Considerations

This plugin requires your Otter.ai credentials to function. These credentials are stored in your agent's configuration and are used to authenticate with Otter.ai. Ensure that your agent's configuration file is secure and not exposed to unauthorized users.

## License

MIT