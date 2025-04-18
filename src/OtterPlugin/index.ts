// File: index.ts
import type { Plugin, IAgentRuntime } from "@elizaos/core";
import { logger } from "@elizaos/core";
import { fetchTranscripts, fetchMeetingSummary } from "././actions";
import { OtterService, TranscriptDbService } from "./services";
import { otterContextProvider } from "././providers";
import { health } from "./routes";

export const otterPlugin: Plugin = {
  init: async (config: Record<string, string>, runtime: IAgentRuntime) => {
    logger.info("Initializing Otter.ai plugin");
    logger.info(config);
    
    // Check for required configuration
    const requiredSettings = ["OTTER_EMAIL", "OTTER_PASSWORD"];
    const missingSettings = requiredSettings.filter(setting => !runtime.getSetting(setting));
    
    if (missingSettings.length > 0) {
      logger.error(`Missing required settings: ${missingSettings.join(", ")}`);
      return;
    }
    
    logger.info("Otter.ai plugin initialized successfully");
  },
  name: "otter",
  description: "Plugin to integrate with Otter.ai for accessing transcripts and meeting summaries",
  actions: [fetchTranscripts, fetchMeetingSummary],
  providers: [otterContextProvider],
  evaluators: [],
  services: [OtterService, TranscriptDbService],
  routes: [health],
};

export * as actions from "././actions";
