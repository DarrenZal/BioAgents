// File: services/transcriptDbService.ts
import { Service, IAgentRuntime, logger } from "@elizaos/core";

/**
 * Interface for transcript data to be stored in the database
 */
export interface StoredTranscript {
  id: string;
  speechId: string;
  title: string;
  content: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  metadata: any;
}

/**
 * Service for storing and retrieving transcript data in a database
 * This is a placeholder implementation that uses the runtime's cache
 * In a production environment, this would use a proper database like PostgreSQL
 */
export class TranscriptDbService extends Service {
  static serviceType = "transcript_db";
  capabilityDescription = "Store and retrieve transcript data for reasoning";
  
  constructor(protected runtime: IAgentRuntime) {
    super(runtime);
  }
  
  static async start(runtime: IAgentRuntime) {
    logger.info("Starting Transcript DB service");
    const service = new TranscriptDbService(runtime);
    return service;
  }
  
  static async stop(runtime: IAgentRuntime) {
    logger.info("Stopping Transcript DB service");
    const service = runtime.getService<TranscriptDbService>(TranscriptDbService.serviceType);
    if (!service) {
      throw new Error("Transcript DB service not found");
    }
    service.stop();
  }
  
  async stop() {
    logger.info("Stopping Transcript DB service instance");
  }
  
  /**
   * Store a transcript in the database
   * @param transcript The transcript data to store
   */
  async storeTranscript(transcript: StoredTranscript): Promise<boolean> {
    try {
      logger.debug(`TranscriptDbService.storeTranscript: Storing transcript ${transcript.speechId}`);
      
      // In a real implementation, this would insert/update a record in a database
      // For now, we'll use the runtime's cache as a simple storage mechanism
      const cache = await this.getCache();
      if (!cache) {
        logger.error("TranscriptDbService.storeTranscript: Cache not available");
        return false;
      }
      
      const key = `transcript:${transcript.speechId}`;
      await cache.set(key, transcript, 0); // 0 = no expiration
      
      logger.debug(`TranscriptDbService.storeTranscript: Successfully stored transcript ${transcript.speechId}`);
      return true;
    } catch (error) {
      logger.error(`TranscriptDbService.storeTranscript: Error storing transcript ${transcript.speechId}:`, error);
      return false;
    }
  }
  
  /**
   * Retrieve a transcript from the database
   * @param speechId The ID of the transcript to retrieve
   */
  async getTranscript(speechId: string): Promise<StoredTranscript | null> {
    try {
      logger.debug(`TranscriptDbService.getTranscript: Retrieving transcript ${speechId}`);
      
      // In a real implementation, this would query a database
      // For now, we'll use the runtime's cache
      const cache = await this.getCache();
      if (!cache) {
        logger.error("TranscriptDbService.getTranscript: Cache not available");
        return null;
      }
      
      const key = `transcript:${speechId}`;
      const transcript = await cache.get(key);
      
      if (!transcript) {
        logger.debug(`TranscriptDbService.getTranscript: Transcript ${speechId} not found in cache`);
        return null;
      }
      
      logger.debug(`TranscriptDbService.getTranscript: Successfully retrieved transcript ${speechId}`);
      return transcript as StoredTranscript;
    } catch (error) {
      logger.error(`TranscriptDbService.getTranscript: Error retrieving transcript ${speechId}:`, error);
      return null;
    }
  }
  
  /**
   * Helper method to get cache safely
   */
  private async getCache(): Promise<any> {
    try {
      // Cast to Function and pass a dummy parameter to bypass type checking
      return await (this.runtime.getCache as Function)(null);
    } catch (error) {
      logger.debug("Error getting cache:", error);
      return null;
    }
  }
}

export default TranscriptDbService;
