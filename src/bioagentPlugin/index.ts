import type { Plugin, IAgentRuntime } from "@elizaos/core";
import { logger } from "@elizaos/core";
import { dkgInsert } from "./actions/dkgInsert";
import { HypothesisService } from "./services";
// import { initDriveSync } from "./helper";  // Comment out this import
import { /* gdriveManualSync, gdriveWebhook, */ health } from "./routes";

export const dkgPlugin: Plugin = {
  init: async (config: Record<string, string>, runtime: IAgentRuntime) => {
    logger.info("Initializing dkg plugin");
    logger.info(config);
    
    // Comment out the Google Drive sync initialization
    /*
    setTimeout(async () => {
      await initDriveSync(runtime);
    }, 20000); // prevent undefined error, the db property is not available immediately
    */
    
    logger.info("Google Drive sync disabled");
  },
  name: "dkg",
  description:
    "Agent DKG which allows you to store memories on the OriginTrail Decentralized Knowledge Graph",
  actions: [dkgInsert],
  providers: [],
  evaluators: [],
  services: [HypothesisService],
  routes: [health /* , gdriveWebhook, gdriveManualSync */],
};

export * as actions from "./actions";