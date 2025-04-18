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
        
        // Check if user is asking to reason about a transcript
        const reasonMatch = messageText.match(/reason(?:\s+about)?\s+transcript(?:\s+for)?(?:\s+id)?\s+["']?([a-zA-Z0-9_-]+)["']?/i);
        if (reasonMatch) {
          return await handleTranscriptReasoning(runtime, otterService, reasonMatch[1], message, callback);
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
      [
        {
          user: "{{user1}}",
          content: { 
            text: "Reason about transcript 77NXWSPLSSXQ56JU", 
            action: "FETCH_OTTER_TRANSCRIPTS" 
          },
        },
        {
          name: "{{user2}}",
          content: { text: "Based on my analysis of this transcript, here are the key insights and takeaways..." },
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
      
      logger.debug(`handleSpecificTranscript: Formatting transcript content`);
      logger.debug(`handleSpecificTranscript: Transcript object keys: ${Object.keys(transcript).join(', ')}`);
      
      // First check if we have paragraphs in the transcript
      if (transcript.transcript && transcript.transcript.paragraphs) {
        logger.debug(`handleSpecificTranscript: Found ${transcript.transcript.paragraphs.length} paragraphs`);
        
        if (transcript.transcript.paragraphs.length > 0) {
          for (const paragraph of transcript.transcript.paragraphs) {
            logger.debug(`handleSpecificTranscript: Paragraph keys: ${Object.keys(paragraph).join(', ')}`);
            logger.debug(`handleSpecificTranscript: Paragraph text: ${paragraph.text ? paragraph.text.substring(0, 50) + '...' : 'No text'}`);
            
            const speakerPrefix = paragraph.speaker_name ? `**${paragraph.speaker_name}**: ` : '';
            const timeStamp = `[${formatDuration(paragraph.start_time)}] `;
            formattedContent += `${timeStamp}${speakerPrefix}${paragraph.text}\n\n`;
          }
          
          logger.debug(`handleSpecificTranscript: Formatted content length: ${formattedContent.length}`);
        } else {
          logger.warn(`handleSpecificTranscript: Transcript has 0 paragraphs`);
          formattedContent = "This transcript has no content yet. It may still be processing or may not have any recorded speech.";
          
          // If there's an audio URL, suggest the user can listen to the audio
          if (transcript.audio_url) {
            formattedContent += "\n\nThe audio recording is available, but the transcript text is not yet ready.";
          }
        }
      } 
      // If no paragraphs, check if we have raw transcripts array
      else if (transcript.transcripts && Array.isArray(transcript.transcripts) && transcript.transcripts.length > 0) {
        logger.debug(`handleSpecificTranscript: No paragraphs found, but found ${transcript.transcripts.length} raw transcripts`);
        
        // Group transcripts by speaker for better readability
        let currentSpeaker = null;
        let currentText = "";
        
        for (const t of transcript.transcripts) {
          // If speaker changed or this is a new segment with significant time gap, start a new paragraph
          if (t.speaker_id !== currentSpeaker || currentText.length === 0) {
            // Add the previous paragraph if it exists
            if (currentText.length > 0) {
              const speakerPrefix = currentSpeaker ? `**Speaker ${currentSpeaker}**: ` : '';
              formattedContent += `${speakerPrefix}${currentText}\n\n`;
            }
            
            // Start a new paragraph
            currentSpeaker = t.speaker_id;
            currentText = t.transcript || "";
          } else {
            // Continue the current paragraph
            currentText += " " + (t.transcript || "");
          }
        }
        
        // Add the last paragraph
        if (currentText.length > 0) {
          const speakerPrefix = currentSpeaker ? `**Speaker ${currentSpeaker}**: ` : '';
          formattedContent += `${speakerPrefix}${currentText}\n\n`;
        }
        
        logger.debug(`handleSpecificTranscript: Formatted content length from raw transcripts: ${formattedContent.length}`);
      } else {
        logger.warn(`handleSpecificTranscript: No transcript paragraphs found`);
        logger.debug(`handleSpecificTranscript: Transcript object: ${JSON.stringify(transcript, null, 2)}`);
        formattedContent = "No transcript content available. The transcript may still be processing or may not exist.";
        
        // If there's a title or summary, at least show that information
        if (transcript.title || transcript.summary) {
          formattedContent += "\n\nHowever, some metadata is available for this recording.";
        }
      }
      
      // Prepare response with metadata, summary, and outline
      let response = `## Transcript: ${transcript.title || "Untitled"}\n\n`;
      
      if (transcript.created_at) {
        response += `**Date**: ${formatDate(transcript.created_at)}\n\n`;
      }
      
      // Check if we have a summary
      if (transcript.summary) {
        response += `**Summary**:\n${transcript.summary}\n\n`;
      }
      
      // Check if we have word clouds (keywords)
      if (transcript.word_clouds && Array.isArray(transcript.word_clouds) && transcript.word_clouds.length > 0) {
        response += `**Keywords**:\n`;
        const keywords = transcript.word_clouds.map(wc => wc.word).join(", ");
        response += keywords + "\n\n";
      }
      
      // Check if we have a speech outline
      if (transcript.speech_outline && Array.isArray(transcript.speech_outline) && transcript.speech_outline.length > 0) {
        response += `**Outline**:\n`;
        
        for (const section of transcript.speech_outline) {
          response += `- ${section.text}\n`;
          
          if (section.segments && Array.isArray(section.segments)) {
            for (const segment of section.segments) {
              response += `  - ${segment.text}\n`;
            }
          }
        }
        
        response += `\n`;
      }
      
      // Store the transcript in the database for future reasoning
      if (formattedContent.length > 0) {
        logger.debug(`handleSpecificTranscript: Storing transcript ${speechId} in database for future reasoning`);
        await otterService.storeTranscriptInDb(speechId, formattedContent);
      }
      
      // For very large transcripts, we'll send a summary response first, then the content separately
      // This prevents the full transcript from being included in the conversation history
      const MAX_CONTENT_LENGTH = 5000;
      
      if (formattedContent.length > MAX_CONTENT_LENGTH) {
        logger.warn(`handleSpecificTranscript: Transcript content is very large (${formattedContent.length} chars), sending summary first`);
        
        // Send the metadata, summary, and outline first
        await callback({
          text: response + `\n\n**Transcript Content**: [Sending separately due to large size (${formattedContent.length} characters)]`,
          source: message.content.source,
        });
        
        // Then send the content in a separate message
        // This way it won't be included in future context windows
        const contentMessage = `**Transcript Content for ${transcript.title || "Untitled"} (ID: ${speechId})**:\n\n${formattedContent.substring(0, MAX_CONTENT_LENGTH)}`;
        
        if (formattedContent.length > MAX_CONTENT_LENGTH) {
          const remainingChars = formattedContent.length - MAX_CONTENT_LENGTH;
          const note = `\n\n*Note: This transcript is ${formattedContent.length} characters long. Only showing the first ${MAX_CONTENT_LENGTH} characters. ${remainingChars} characters were truncated.*\n\nTo analyze this transcript, ask: "reason about transcript ${speechId}"`;
          await callback({
            text: contentMessage + note,
            source: message.content.source,
          });
        } else {
          await callback({
            text: contentMessage + `\n\nTo analyze this transcript, ask: "reason about transcript ${speechId}"`,
            source: message.content.source,
          });
        }
        
        logger.debug("handleSpecificTranscript: Sent transcript content separately");
        return true;
      } else {
        // For smaller transcripts, include the content in the main response
        response += `**Transcript Content**:\n\n${formattedContent}`;
        response += `\n\nTo analyze this transcript, ask: "reason about transcript ${speechId}"`;
        
        logger.debug("handleSpecificTranscript: Sending response to user");
        await callback({
          text: response,
          source: message.content.source,
        });
        logger.debug("handleSpecificTranscript: Response sent successfully");
        return true;
      }
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
        
        if (speech.has_summary && speech.summary) {
          // Show a preview of the summary (first 100 characters)
          const summaryPreview = speech.summary.length > 100 
            ? speech.summary.substring(0, 100) + "..." 
            : speech.summary;
          response += `- **Summary**: ${summaryPreview}\n`;
        } else if (speech.has_summary) {
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
  
  async function handleTranscriptReasoning(
    runtime: IAgentRuntime,
    otterService: OtterService,
    speechId: string,
    message: Memory,
    callback: HandlerCallback
  ): Promise<boolean> {
    try {
      await callback({
        text: `Analyzing transcript with ID: ${speechId}...`,
        source: message.content.source,
      });
      
      // First, check if we have the transcript in the database
      let storedTranscript = await otterService.getTranscriptFromDb(speechId);
      
      // If not in database, fetch it and store it
      if (!storedTranscript) {
        logger.debug(`handleTranscriptReasoning: Transcript ${speechId} not found in database, fetching from API`);
        
        // Get the transcript details from the API
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
        
        // First check if we have paragraphs in the transcript
        if (transcript.transcript && transcript.transcript.paragraphs) {
          if (transcript.transcript.paragraphs.length > 0) {
            for (const paragraph of transcript.transcript.paragraphs) {
              const speakerPrefix = paragraph.speaker_name ? `${paragraph.speaker_name}: ` : '';
              formattedContent += `${speakerPrefix}${paragraph.text}\n\n`;
            }
          }
        } 
        // If no paragraphs, check if we have raw transcripts array
        else if (transcript.transcripts && Array.isArray(transcript.transcripts) && transcript.transcripts.length > 0) {
          // Group transcripts by speaker for better readability
          let currentSpeaker = null;
          let currentText = "";
          
          for (const t of transcript.transcripts) {
            // If speaker changed or this is a new segment with significant time gap, start a new paragraph
            if (t.speaker_id !== currentSpeaker || currentText.length === 0) {
              // Add the previous paragraph if it exists
              if (currentText.length > 0) {
                const speakerPrefix = currentSpeaker ? `Speaker ${currentSpeaker}: ` : '';
                formattedContent += `${speakerPrefix}${currentText}\n\n`;
              }
              
              // Start a new paragraph
              currentSpeaker = t.speaker_id;
              currentText = t.transcript || "";
            } else {
              // Continue the current paragraph
              currentText += " " + (t.transcript || "");
            }
          }
          
          // Add the last paragraph
          if (currentText.length > 0) {
            const speakerPrefix = currentSpeaker ? `Speaker ${currentSpeaker}: ` : '';
            formattedContent += `${speakerPrefix}${currentText}\n\n`;
          }
        }
        
        // Store the transcript in the database
        if (formattedContent.length > 0) {
          const stored = await otterService.storeTranscriptInDb(speechId, formattedContent);
          if (stored) {
            logger.debug(`handleTranscriptReasoning: Successfully stored transcript ${speechId} in database`);
            // Get the stored transcript
            storedTranscript = await otterService.getTranscriptFromDb(speechId);
          } else {
            logger.error(`handleTranscriptReasoning: Failed to store transcript ${speechId} in database`);
          }
        }
      }
      
      // If we have a stored transcript, use it for reasoning
      if (storedTranscript) {
        logger.debug(`handleTranscriptReasoning: Using stored transcript ${speechId} for reasoning`);
        
        // Prepare the response with metadata and content
        let response = `## Analysis of Transcript: ${storedTranscript.title}\n\n`;
        
        // Add metadata
        response += `**Date**: ${formatDate(storedTranscript.createdAt)}\n\n`;
        
        if (storedTranscript.summary) {
          response += `**Summary**:\n${storedTranscript.summary}\n\n`;
        }
        
        // Add the transcript content (up to a reasonable limit for the LLM)
        const MAX_CONTENT_LENGTH = 50000; // Use a larger limit for reasoning
        const contentToAnalyze = storedTranscript.content.length > MAX_CONTENT_LENGTH
          ? storedTranscript.content.substring(0, MAX_CONTENT_LENGTH) + "..."
          : storedTranscript.content;
        
        response += `**Transcript Content**:\n\n${contentToAnalyze}\n\n`;
        
        // Add a prompt for the LLM to analyze the transcript
        response += `**Analysis**:\n\nBased on the transcript above, here are the key insights and takeaways:\n\n`;
        
        // Send the response
        await callback({
          text: response,
          source: message.content.source,
        });
        
        return true;
      } else {
        // If we still don't have a stored transcript, return an error
        await callback({
          text: `Unable to analyze transcript ${speechId}. The transcript could not be retrieved or processed.`,
          source: message.content.source,
        });
        return false;
      }
    } catch (error) {
      logger.error(`Error analyzing transcript ${speechId}:`, error);
      await callback({
        text: `Error analyzing transcript: ${error.message}`,
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
