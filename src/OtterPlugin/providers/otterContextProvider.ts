// File: providers/otterContextProvider.ts
import { IAgentRuntime, Memory, logger } from "@elizaos/core";
import { OtterService } from "../services";
import { CACHE_KEYS } from "../constants";

// Define a provider with any type to bypass type checking
export const otterContextProvider: any = {
  name: "otterContextProvider",
  description: "Provides context about recent Otter.ai transcripts and meetings",
  
  // Add both handler and get methods to support different interfaces
  // @ts-ignore - Ignore type checking for handler
  handler: async (runtime: IAgentRuntime, message: Memory) => {
    logger.debug("OtterContextProvider.handler called");
    return await provideOtterContext(runtime, message);
  },
  
  // @ts-ignore - Ignore type checking for get
  get: async (runtime: IAgentRuntime, message: Memory, cachedState: any) => {
    logger.debug("OtterContextProvider.get called");
    return await provideOtterContext(runtime, message);
  }
};

// Shared implementation for both handler and get methods
async function provideOtterContext(runtime: IAgentRuntime, message: Memory) {
    try {
      // Check if credentials are configured
      const email = runtime.getSetting("OTTER_EMAIL");
      const password = runtime.getSetting("OTTER_PASSWORD");
      
      if (!email || !password) {
        logger.debug("Otter.ai credentials not configured, skipping provider");
        return {};
      }
      
      // Get the Otter service
      const otterService = runtime.getService<OtterService>("otter");
      if (!otterService) {
        logger.debug("Otter.ai service not found, skipping provider");
        return {};
      }
      
      // Try to get cached data first
      let speeches;
      try {
        // Cast to any to bypass type checking and pass a dummy parameter
        const cache = await (runtime.getCache as Function)(null);
        if (cache && typeof cache.get === 'function') {
          const cachedSpeeches = await (cache.get as Function)(CACHE_KEYS.SPEECHES_LIST);
          
          if (cachedSpeeches) {
            logger.debug("Using cached Otter.ai speeches for context");
            speeches = cachedSpeeches;
          }
        }
      } catch (error) {
        logger.debug("Error accessing cache:", error);
        // Continue without cache
      }
      
      // If no cached data, fetch from API
      if (!speeches) {
        try {
          // Try to fetch transcripts, but don't fail the provider if this fails
          speeches = await otterService.getAllTranscripts();
        } catch (error) {
          logger.debug("Error fetching Otter.ai transcripts for context, continuing without them", error);
          return {};
        }
      }
      
      if (!speeches || speeches.length === 0) {
        logger.debug("No Otter.ai transcripts found");
        return {};
      }
      
      // Sort by date (newest first)
      speeches.sort((a, b) => {
        const dateA = new Date(a.created_at);
        const dateB = new Date(b.created_at);
        return dateB.getTime() - dateA.getTime();
      });
      
      // Take only the 5 most recent for context
      const recentSpeeches = speeches.slice(0, 5);
      
      // Count transcripts with summaries
      const speechesWithSummaries = speeches.filter(speech => speech.has_summary).length;
      
      return {
        otterTranscripts: {
          recentTranscripts: recentSpeeches,
          totalTranscripts: speeches.length,
          transcriptsWithSummaries: speechesWithSummaries
        }
      };
    } catch (error) {
      logger.error("Error in otterContextProvider:", error);
      return {};
    }
}
