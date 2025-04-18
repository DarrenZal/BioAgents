// File: actions/fetchTranscripts.ts
import {
    type IAgentRuntime,
    type Memory,
    type State,
    logger,
    type HandlerCallback,
    type ActionExample,
    type Action,
  } from "@elizaos/core";
  import { OtterService } from "../services";
  import { formatDate, formatDuration, ERROR_MESSAGES } from "../constants";
  
  export const fetchTranscripts: Action = {
    name: "FETCH_OTTER_TRANSCRIPTS",
    similes: ["GET_OTTER_TRANSCRIPTS", "SHOW_OTTER_TRANSCRIPTS", "LIST_OTTER_TRANSCRIPTS"],
    description: "Fetch transcripts from Otter.ai",
    validate: async (runtime: IAgentRuntime, _message: Memory) => {
      const requiredSettings = ["OTTER_EMAIL", "OTTER_PASSWORD"];
      const missingSettings = requiredSettings.filter(setting => !runtime.getSetting(setting));
      
      if (missingSettings.length > 0) {
        logger.error(`Missing required settings for Otter.ai: ${missingSettings.join(", ")}`);
        return false;
      }
      
      return true;
    },
    handler: async (
      runtime: IAgentRuntime,
      message: Memory,
      state: State,
      _options: { [key: string]: unknown },
      callback: HandlerCallback
    ): Promise<boolean> => {
      try {
          await callback({
          text: "Fetching your Otter.ai transcripts...",
          source: message.content.source,
        });
        
        // Get the Otter service
        const otterService = runtime.getService<OtterService>("otter");
        if (!otterService) {
          throw new Error(ERROR_MESSAGES.SERVICE_NOT_FOUND);
        }
        
        // Parse message to check for specific transcript ID request
        const messageText = typeof message.content === "string" 
          ? message.content 
          : message.content.text || "";
        
        // Check for search query
        const searchMatch = messageText.match(/search(?:\s+for)?\s+["']?([^"']+)["']?/i);
        if (searchMatch) {
          return await handleTranscriptSearch(runtime, otterService, searchMatch[1], message, callback);
        }
        
        // Check if user is asking for a specific transcript
        const speechIdMatch = messageText.match(/transcript(?:\s+for)?(?:\s+id)?\s+["']?([a-zA-Z0-9_-]+)["']?/i);
        const speechId = speechIdMatch ? speechIdMatch[1] : null;
        
        // If specific transcript requested, fetch just that one
        if (speechId) {
          return await handleSpecificTranscript(runtime, otterService, speechId, message, callback);
        }
        
        // Otherwise, list recent transcripts
        return await handleTranscriptListing(runtime, otterService, message, callback);
        
      } catch (error) {
        logger.error("Error in fetchTranscripts action:", error);
        await callback({
          text: `Error fetching Otter.ai transcripts: ${error.message}`,
          source: message.content.source,
        });
        return false;
      }
    },
    examples: [
      [
        {
          user: "{{user1}}",
          content: {
            text: "Show me my Otter.ai transcripts",
            action: "FETCH_OTTER_TRANSCRIPTS",
          },
        },
        {
          name: "{{user2}}",
          content: { text: "Here are your recent Otter.ai transcripts..." },
        },
      ],
      [
        {
          user: "{{user1}}",
          content: { 
            text: "Get the transcript for 77NXWSPLSSXQ56JU", 
            action: "FETCH_OTTER_TRANSCRIPTS" 
          },
        },
        {
            name: "{{user2}}",
          content: { text: "Here's the transcript you requested..." },
        },
      ],
      [
        {
          user: "{{user1}}",
          content: { 
            text: "Search for 'machine learning' in my transcripts", 
            action: "FETCH_OTTER_TRANSCRIPTS" 
          },
        },
        {
          name: "{{user2}}",
          content: { text: "Here are the search results for 'machine learning'..." },
        },
      ],
    ] as ActionExample[][],
  };
  
  async function handleSpecificTranscript(
    runtime: IAgentRuntime,
    otterService: OtterService,
    speechId: string,
    message: Memory,
    callback: HandlerCallback
  ): Promise<boolean> {
    try {
      // Get the transcript details
      await callback({
        text: `Fetching transcript with ID: ${speechId}...`,
        source: message.content.source,
      });
      
      const transcript = await otterService.getTranscriptDetails(speechId);
      
      if (!transcript) {
        await callback({
          text: ERROR_MESSAGES.TRANSCRIPT_NOT_FOUND,
          source: message.content.source,
        });
        return false;
      }
      
      // Format the transcript content
      let formattedContent = '';
      
      if (transcript.transcript && transcript.transcript.paragraphs) {
        for (const paragraph of transcript.transcript.paragraphs) {
          const speakerPrefix = paragraph.speaker_name ? `**${paragraph.speaker_name}**: ` : '';
          const timeStamp = `[${formatDuration(paragraph.start_time)}] `;
          formattedContent += `${timeStamp}${speakerPrefix}${paragraph.text}\n\n`;
        }
      } else {
        formattedContent = "No transcript content available.";
      }
      
      // Prepare response with metadata and content
      let response = `## Transcript: ${transcript.title || "Untitled"}\n\n`;
      
      if (transcript.created_at) {
        response += `**Date**: ${formatDate(transcript.created_at)}\n\n`;
      }
      
      if (transcript.summary) {
        response += `**Summary**:\n${transcript.summary}\n\n`;
      }
      
      response += `**Transcript Content**:\n\n${formattedContent}`;
      
      logger.debug("handleSpecificTranscript: Sending response to user");
      logger.debug("handleTranscriptListing: Sending final response to user with transcript list");
      try {
        await callback({
          text: response,
          source: message.content.source,
        });
        logger.debug("handleTranscriptListing: Final response sent successfully");
      } catch (callbackError) {
        logger.error("handleTranscriptListing: Error sending final response:", callbackError);
        throw callbackError;
      }
      logger.debug("handleSpecificTranscript: Response sent successfully");
      
      return true;
    } catch (error) {
      logger.error(`Error fetching specific transcript ${speechId}:`, error);
      await callback({
        text: `Error fetching the transcript: ${error.message}`,
        source: message.content.source,
      });
      return false;
    }
  }
  
  async function handleTranscriptListing(
    runtime: IAgentRuntime,
    otterService: OtterService,
    message: Memory,
    callback: HandlerCallback
  ): Promise<boolean> {
    try {
      logger.debug("handleTranscriptListing: Starting to fetch transcripts");
      // Get all transcripts
      const speeches = await otterService.getAllTranscripts();
      logger.debug(`handleTranscriptListing: Fetched ${speeches ? speeches.length : 0} transcripts`);
      
      if (!speeches || speeches.length === 0) {
        await callback({
          text: ERROR_MESSAGES.NO_TRANSCRIPTS,
          source: message.content.source,
        });
        return true;
      }
      
      // Sort by date (newest first)
      speeches.sort((a, b) => {
        const dateA = new Date(a.created_at);
        const dateB = new Date(b.created_at);
        return dateB.getTime() - dateA.getTime();
      });
      
      // Take the 10 most recent
      const recentSpeeches = speeches.slice(0, 10);
      
      // Format the response
      logger.debug(`handleTranscriptListing: Formatting response for ${recentSpeeches.length} recent speeches`);
      let response = "## Recent Otter.ai Transcripts\n\n";
      
      for (const speech of recentSpeeches) {
        const dateStr = formatDate(speech.created_at);
        const duration = formatDuration(speech.duration);
        const title = speech.title || "Untitled";
        const statusInfo = speech.transcription_progress === 100 
          ? "Complete" 
          : `In progress (${speech.transcription_progress}%)`;
        
        response += `### ${title}\n`;
        response += `- **ID**: \`${speech.speech_id}\`\n`;
        response += `- **Date**: ${dateStr}\n`;
        response += `- **Duration**: ${duration}\n`;
        response += `- **Status**: ${statusInfo}\n`;
        
        if (speech.has_summary) {
          response += `- **Summary**: Available\n`;
        }
        
        response += `\nTo view this transcript, ask for: "transcript for ${speech.speech_id}"\n\n`;
      }
      
      response += `\nThese are your ${recentSpeeches.length} most recent transcripts out of ${speeches.length} total.`;
      
      logger.debug("handleTranscriptListing: Sending final response to user with transcript list");
      try {
        await callback({
          text: response,
          source: message.content.source,
        });
        logger.debug("handleTranscriptListing: Final response sent successfully");
      } catch (callbackError) {
        logger.error("handleTranscriptListing: Error sending final response:", callbackError);
        throw callbackError;
      }
      
      return true;
    } catch (error) {
      logger.error("Error fetching transcript listing:", error);
      await callback({
        text: `Error fetching transcripts: ${error.message}`,
        source: message.content.source,
      });
      return false;
    }
  }
  
  async function handleTranscriptSearch(
    runtime: IAgentRuntime,
    otterService: OtterService,
    query: string,
    message: Memory,
    callback: HandlerCallback
  ): Promise<boolean> {
    try {
      await callback({
        text: `Searching your Otter.ai transcripts for "${query}"...`,
        source: message.content.source,
      });
      
      const searchResults = await otterService.searchTranscripts(query);
      
      if (!searchResults || searchResults.length === 0) {
        await callback({
          text: `No results found for "${query}" in your Otter.ai transcripts.`,
          source: message.content.source,
        });
        return true;
      }
      
      // Format the response
      let response = `## Search Results for "${query}"\n\n`;
      
      for (const result of searchResults) {
        const title = result.title || "Untitled";
        const dateStr = formatDate(result.created_at);
        
        response += `### ${title}\n`;
        response += `- **ID**: \`${result.speech_id}\`\n`;
        response += `- **Date**: ${dateStr}\n`;
        response += `- **Matches**: ${result.matches.length}\n\n`;
        
        // Show matched text excerpts (up to 3)
        const maxExcerpts = Math.min(3, result.matches.length);
        if (maxExcerpts > 0) {
          response += `**Excerpts**:\n`;
          
          for (let i = 0; i < maxExcerpts; i++) {
            const match = result.matches[i];
            response += `> ${match.text}\n\n`;
          }
        }
        
        response += `To view this transcript, ask for: "transcript for ${result.speech_id}"\n\n`;
      }
      
      response += `Found ${searchResults.length} transcript(s) containing "${query}".`;
      
      await callback({
        text: response,
        source: message.content.source,
      });
      
      return true;
    } catch (error) {
      logger.error(`Error searching transcripts for "${query}":`, error);
      await callback({
        text: `Error searching transcripts: ${error.message}`,
        source: message.content.source,
      });
      return false;
    }
  }
