import { logger, IAgentRuntime, elizaLogger } from "@elizaos/core";
import { generateHypothesis } from "./generateHypothesis";
import { sendEvaluationToDiscord } from "./evaluateHypothesis";

export const hypGenEvalLoop = async (agentRuntime: IAgentRuntime) => {
  // Check if hypothesis generation is disabled
  const isDisabled = process.env.DISABLE_HYPOTHESIS_GENERATION === 'true';
  
  if (isDisabled) {
    logger.info("Hypothesis generation is disabled via DISABLE_HYPOTHESIS_GENERATION env var");
    return null;
  }
  
  logger.info("Starting hypothesis generation interval");

  const interval = setInterval(async () => {
    let hypothesis, hypothesisMessageId;

      try {
        const result = await generateHypothesis(agentRuntime);
      
        if (!result) {
          logger.error("generateHypothesis returned no result, possibly due to API overload");
          return; // or retry logic
        }
      
        ({ hypothesis, hypothesisMessageId } = result);
      
      } catch (err) {
        logger.error("Error during hypothesis generation:", err);
        return; // or retry logic
      }

    elizaLogger.log(hypothesis);
    await sendEvaluationToDiscord(
      agentRuntime,
      hypothesis,
      hypothesisMessageId
    );
  }, 150000);
  return interval;
};

export const stopHypGenEvalLoop = (interval: NodeJS.Timeout) => {
  logger.info("Stopping hypothesis generation interval");
  clearInterval(interval);
};
