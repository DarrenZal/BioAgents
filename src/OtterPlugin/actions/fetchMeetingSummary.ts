// File: actions/fetchMeetingSummary.ts
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
  
  export const fetchMeetingSummary: Action = {
    name: "FETCH_OTTER_SUMMARY",
    similes: ["GET_OTTER_SUMMARY", "SHOW_OTTER_SUMMARY", "MEETING_SUMMARY"],
    description: "Fetch meeting summaries from Otter.ai",
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
          text: "Fetching your Otter.ai meeting summaries...",
          source: message.content.source,
        });
        
        // Get the Otter service
        const otterService = runtime.getService<OtterService>("otter");
        if (!otterService) {
          throw new Error(ERROR_MESSAGES.SERVICE_NOT_FOUND);
        }
        
        // Parse message to check for specific meeting ID
        const messageText = typeof message.content === "string" 
          ? message.content 
          : message.content.text || "";
        
        // Check if user is asking for a specific meeting summary
        const speechIdMatch = messageText.match(/summary(?:\s+for)?(?:\s+id)?\s+["']?([a-zA-Z0-9_-]+)["']?/i);
        const speechId = speechIdMatch ? speechIdMatch[1] : null;
        
        // If specific meeting summary requested, fetch just that one
        if (speechId) {
          return await handleSpecificSummary(runtime, otterService, speechId, message, callback);
        }
        
        // Otherwise, list recent meetings with summaries
        return await handleSummaryListing(runtime, otterService, message, callback);
        
      } catch (error) {
        logger.error("Error in fetchMeetingSummary action:", error);
        await callback({
          text: `Error fetching Otter.ai meeting summaries: ${error.message}`,
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
            text: "Show me my Otter.ai meeting summaries",
            action: "FETCH_OTTER_SUMMARY",
          },
        },
        {
          name: "{{user2}}",
          content: { text: "Here are your recent Otter.ai meeting summaries..." },
        },
      ],
      [
        {
          user: "{{user1}}",
          content: { 
            text: "Get the summary for 77NXWSPLSSXQ56JU", 
            action: "FETCH_OTTER_SUMMARY" 
          },
        },
        {
          name: "{{user2}}",
          content: { text: "Here's the meeting summary you requested..." },
        },
      ],
    ] as ActionExample[][],
  };
  
  async function handleSpecificSummary(
    runtime: IAgentRuntime,
    otterService: OtterService,
    speechId: string,
    message: Memory,
    callback: HandlerCallback
  ): Promise<boolean> {
    try {
      // Get the transcript details
      await callback({
        text: `Fetching meeting summary with ID: ${speechId}...`,
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
      
      if (!transcript.summary) {
        await callback({
          text: `No summary available for meeting "${transcript.title || 'Untitled'}" (ID: ${speechId})`,
          source: message.content.source,
        });
        return false;
      }
      
      // Prepare response with metadata and summary
      let response = `## Meeting Summary: ${transcript.title || "Untitled"}\n\n`;
      
      if (transcript.created_at) {
        response += `**Date**: ${formatDate(transcript.created_at)}\n\n`;
      }
      
      response += `**Summary**:\n${transcript.summary}\n\n`;
      
      response += `To view the full transcript, ask for: "transcript for ${speechId}"`;
      
      await callback({
        text: response,
        source: message.content.source,
      });
      
      return true;
    } catch (error) {
      logger.error(`Error fetching specific meeting summary ${speechId}:`, error);
      await callback({
        text: `Error fetching the meeting summary: ${error.message}`,
        source: message.content.source,
      });
      return false;
    }
  }
  
  async function handleSummaryListing(
    runtime: IAgentRuntime,
    otterService: OtterService,
    message: Memory,
    callback: HandlerCallback
  ): Promise<boolean> {
    try {
      // Get all transcripts
      const speeches = await otterService.getAllTranscripts();
      
      if (!speeches || speeches.length === 0) {
        await callback({
          text: ERROR_MESSAGES.NO_TRANSCRIPTS,
          source: message.content.source,
        });
        return true;
      }
      
      // Filter to only include meetings with summaries
      const meetingsWithSummaries = speeches.filter(speech => speech.has_summary);
      
      if (meetingsWithSummaries.length === 0) {
        await callback({
          text: ERROR_MESSAGES.NO_SUMMARIES,
          source: message.content.source,
        });
        return true;
      }
      
      // Sort by date (newest first)
      meetingsWithSummaries.sort((a, b) => {
        const dateA = new Date(a.created_at);
        const dateB = new Date(b.created_at);
        return dateB.getTime() - dateA.getTime();
      });
      
      // Take the 10 most recent
      const recentMeetings = meetingsWithSummaries.slice(0, 10);
      
      // Format the response
      let response = "## Recent Otter.ai Meeting Summaries\n\n";
      
      for (const meeting of recentMeetings) {
        const dateStr = formatDate(meeting.created_at);
        const duration = formatDuration(meeting.duration);
        const title = meeting.title || "Untitled";
        
        response += `### ${title}\n`;
        response += `- **ID**: \`${meeting.speech_id}\`\n`;
        response += `- **Date**: ${dateStr}\n`;
        response += `- **Duration**: ${duration}\n`;
        response += `\nTo view this meeting summary, ask for: "summary for ${meeting.speech_id}"\n\n`;
      }
      
      response += `\nThese are your ${recentMeetings.length} most recent meetings with summaries out of ${speeches.length} total meetings.`;
      
      await callback({
        text: response,
        source: message.content.source,
      });
      
      return true;
    } catch (error) {
      logger.error("Error fetching meeting summary listing:", error);
      await callback({
        text: `Error fetching meeting summaries: ${error.message}`,
        source: message.content.source,
      });
      return false;
    }
  }
