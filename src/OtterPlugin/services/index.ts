// File: services/index.ts
import { Service, IAgentRuntime, logger } from "@elizaos/core";
import OtterApi from "./OtterApi";
import TranscriptDbService, { StoredTranscript } from "./transcriptDbService";
import { CACHE_KEYS } from "../constants";

export { TranscriptDbService };

export class OtterService extends Service {
  static serviceType = "otter";
  capabilityDescription = "Access Otter.ai transcripts and meeting summaries";
  private api: OtterApi | null = null;

  constructor(protected runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime) {
    logger.info("Starting Otter.ai service");
    const service = new OtterService(runtime);
    
    // Initialize the API
    await service.initializeApi();
    
    return service;
  }

  // Helper method to get cache safely
  private async getCache(): Promise<any> {
    try {
      // Cast to Function and pass a dummy parameter to bypass type checking
      return await (this.runtime.getCache as Function)(null);
    } catch (error) {
      logger.debug("Error getting cache:", error);
      return null;
    }
  }

  static async stop(runtime: IAgentRuntime) {
    logger.info("Stopping Otter.ai service");
    const service = runtime.getService<OtterService>(OtterService.serviceType);
    if (!service) {
      throw new Error("Otter.ai service not found");
    }
    service.stop();
  }

  async stop() {
    logger.info("Stopping Otter.ai service instance");
    // No specific cleanup needed for API client
  }
  
  /**
   * Get or create the TranscriptDbService
   */
  private async getTranscriptDbService(): Promise<TranscriptDbService> {
    // Check if the service exists
    let dbService = this.runtime.getService<TranscriptDbService>(TranscriptDbService.serviceType);
    
    // If not, create it
    if (!dbService) {
      logger.debug("OtterService: TranscriptDbService not found, creating it");
      dbService = await TranscriptDbService.start(this.runtime);
      // Note: In a real implementation, we would register the service properly
      // For now, we'll just use it directly
    }
    
    return dbService;
  }
  
  /**
   * Store a transcript in the database
   * @param speechId The ID of the speech/transcript to store
   * @param formattedContent The formatted transcript content
   */
  async storeTranscriptInDb(speechId: string, formattedContent: string): Promise<boolean> {
    try {
      logger.debug(`OtterService.storeTranscriptInDb: Storing transcript ${speechId}`);
      
      // Get the transcript details
      const transcript = await this.getTranscriptDetails(speechId);
      
      if (!transcript) {
        logger.error(`OtterService.storeTranscriptInDb: Transcript ${speechId} not found`);
        return false;
      }
      
      // Get the TranscriptDbService
      const dbService = await this.getTranscriptDbService();
      
      // Create a StoredTranscript object
      const storedTranscript: StoredTranscript = {
        id: `tr-${Date.now()}`,
        speechId: speechId,
        title: transcript.title || "Untitled",
        content: formattedContent,
        summary: transcript.summary || "",
        createdAt: transcript.created_at,
        updatedAt: new Date().toISOString(),
        metadata: {
          speech_outline: transcript.speech_outline,
          word_clouds: transcript.word_clouds,
          audio_url: transcript.audio_url
        }
      };
      
      // Store the transcript
      const result = await dbService.storeTranscript(storedTranscript);
      
      if (result) {
        logger.debug(`OtterService.storeTranscriptInDb: Successfully stored transcript ${speechId}`);
      } else {
        logger.error(`OtterService.storeTranscriptInDb: Failed to store transcript ${speechId}`);
      }
      
      return result;
    } catch (error) {
      logger.error(`OtterService.storeTranscriptInDb: Error storing transcript ${speechId}:`, error);
      return false;
    }
  }
  
  /**
   * Get a transcript from the database
   * @param speechId The ID of the speech/transcript to retrieve
   */
  async getTranscriptFromDb(speechId: string): Promise<StoredTranscript | null> {
    try {
      logger.debug(`OtterService.getTranscriptFromDb: Retrieving transcript ${speechId}`);
      
      // Get the TranscriptDbService
      const dbService = await this.getTranscriptDbService();
      
      // Get the transcript
      const transcript = await dbService.getTranscript(speechId);
      
      if (!transcript) {
        logger.debug(`OtterService.getTranscriptFromDb: Transcript ${speechId} not found in database`);
        return null;
      }
      
      logger.debug(`OtterService.getTranscriptFromDb: Successfully retrieved transcript ${speechId}`);
      return transcript;
    } catch (error) {
      logger.error(`OtterService.getTranscriptFromDb: Error retrieving transcript ${speechId}:`, error);
      return null;
    }
  }

  /**
   * Initialize the Otter.ai API client
   */
  async initializeApi(): Promise<void> {
    try {
      logger.debug("OtterService.initializeApi: Initializing Otter.ai API client");
      const email = this.runtime.getSetting("OTTER_EMAIL");
      const password = this.runtime.getSetting("OTTER_PASSWORD");
      
      if (!email || !password) {
        logger.error("OtterService.initializeApi: Otter.ai credentials not configured");
        throw new Error("Otter.ai credentials not configured");
      }
      
      logger.debug(`OtterService.initializeApi: Got credentials`);
      
      this.api = new OtterApi({
        email,
        password
      });
      
      await this.api.init();
      logger.info("Otter.ai API initialized successfully");
    } catch (error) {
      logger.error("Error initializing Otter.ai API:", error);
      throw error;
    }
  }

  /**
   * Get all transcripts
   */
  async getAllTranscripts(useCache = true): Promise<any[]> {
    logger.debug("OtterService.getAllTranscripts called");
    if (!this.api) {
      logger.debug("OtterService.getAllTranscripts: API not initialized, initializing now");
      await this.initializeApi();
    }
    
    try {
      // Check cache first if enabled
      if (useCache) {
        const cache = await this.getCache();
        if (cache && typeof cache.get === 'function') {
          try {
            const cachedSpeeches = await cache.get(CACHE_KEYS.SPEECHES_LIST);
            
            if (cachedSpeeches) {
              logger.debug("Using cached Otter.ai speeches");
              return cachedSpeeches;
            }
          } catch (error) {
            logger.debug("Error accessing cache:", error);
            // Continue with API fetch if cache fails
          }
        }
      }
      
      // Fetch from API
      const speeches = await this.api!.getSpeeches();
      
      // Format the response to standardize date/time handling
      logger.debug("OtterService.getAllTranscripts: Formatting speeches");
      const formattedSpeeches = speeches.map(speech => {
        let createdAtFormatted;
        try {
          // Check if created_at is a valid timestamp
          if (speech.created_at && !isNaN(speech.created_at)) {
            createdAtFormatted = new Date(speech.created_at * 1000).toISOString();
          } else {
            createdAtFormatted = new Date().toISOString(); // Use current date as fallback
            logger.warn(`Invalid created_at timestamp for speech ${speech.speech_id}, using current date instead`);
          }
        } catch (error) {
          createdAtFormatted = new Date().toISOString(); // Use current date as fallback
          logger.warn(`Error formatting created_at for speech ${speech.speech_id}: ${error.message}`);
        }
        
        return {
          speech_id: speech.speech_id,
          title: speech.title || "Untitled",
          summary: speech.summary,
          created_at: createdAtFormatted,
          duration: speech.duration,
          has_summary: !!speech.summary && speech.summary.trim().length > 0,
          has_transcript: speech.process_finished,
          transcription_progress: speech.process_finished ? 100 : 
                                 (speech.upload_finished ? 50 : 0)
        };
      });
      
      // Cache the result
      if (useCache) {
        const cache = await this.getCache();
        if (cache && typeof cache.set === 'function') {
          try {
            await cache.set(CACHE_KEYS.SPEECHES_LIST, formattedSpeeches, 15 * 60); // 15 minutes TTL
          } catch (error) {
            logger.debug("Error setting cache:", error);
            // Continue even if caching fails
          }
        }
      }
      
      return formattedSpeeches;
    } catch (error) {
      logger.error("Error fetching all transcripts:", error);
      throw error;
    }
  }

  /**
   * Get transcript details
   */
  async getTranscriptDetails(speechId: string, useCache = true): Promise<any> {
    if (!this.api) {
      await this.initializeApi();
    }
    
    try {
      // Check cache first if enabled
      if (useCache) {
        const cache = await this.getCache();
        if (cache && typeof cache.get === 'function') {
          try {
            const cacheKey = CACHE_KEYS.SPEECH_DETAIL(speechId);
            const cachedSpeech = await cache.get(cacheKey);
            
            if (cachedSpeech) {
              logger.debug(`Using cached speech details for ${speechId}`);
              return cachedSpeech;
            }
          } catch (error) {
            logger.debug(`Error accessing cache for speech ${speechId}:`, error);
            // Continue with API fetch if cache fails
          }
        }
      }
      
      // Fetch speech details
      logger.debug(`OtterService.getTranscriptDetails: Fetching speech details for ${speechId}`);
      const response = await this.api!.getSpeech(speechId);
      logger.debug(`OtterService.getTranscriptDetails: Got response from API`);
      
      const { speech, transcripts } = response;
      logger.debug(`OtterService.getTranscriptDetails: Speech object keys: ${Object.keys(speech).join(', ')}`);
      logger.debug(`OtterService.getTranscriptDetails: Found ${transcripts.length} transcripts`);
      
      if (transcripts.length === 0) {
        logger.warn(`OtterService.getTranscriptDetails: No transcripts found for speech ${speechId}`);
      } else {
        // Log some details about the first transcript
        const firstTranscript = transcripts[0];
        logger.debug(`OtterService.getTranscriptDetails: First transcript keys: ${Object.keys(firstTranscript).join(', ')}`);
        logger.debug(`OtterService.getTranscriptDetails: First transcript text: ${firstTranscript.transcript ? firstTranscript.transcript.substring(0, 50) + '...' : 'No text'}`);
      }
      
      // Format the response to standardize date/time handling and structure
      let createdAtFormatted;
      try {
        // Check if created_at is a valid timestamp
        if (speech.created_at && !isNaN(speech.created_at)) {
          createdAtFormatted = new Date(speech.created_at * 1000).toISOString();
        } else {
          createdAtFormatted = new Date().toISOString(); // Use current date as fallback
          logger.warn(`Invalid created_at timestamp for speech ${speechId}, using current date instead`);
        }
      } catch (error) {
        createdAtFormatted = new Date().toISOString(); // Use current date as fallback
        logger.warn(`Error formatting created_at for speech ${speechId}: ${error.message}`);
      }
      
      const formattedSpeech = {
        otid: speech.speech_id,
        title: speech.title || "Untitled",
        summary: speech.summary,
        created_at: createdAtFormatted,
        processing_status: speech.process_finished ? "complete" : "processing",
        transcript: {
          paragraphs: transcripts.map(t => ({
            speaker_id: t.speaker_id,
            speaker_name: t.speaker_model_label,
            text: t.transcript,
            start_time: Math.floor(t.start_offset / 1000), // Convert ms to seconds
            end_time: Math.floor(t.end_offset / 1000),     // Convert ms to seconds
          }))
        },
        // Include speech outline if available
        speech_outline: speech.speech_outline || null,
        // Include word clouds if available
        word_clouds: speech.word_clouds || null,
        // Include audio URL if available
        audio_url: speech.audio_url || speech.download_url || null
      };
      
      // Cache the result
      if (useCache) {
        const cache = await this.getCache();
        if (cache && typeof cache.set === 'function') {
          try {
            const cacheKey = CACHE_KEYS.SPEECH_DETAIL(speechId);
            await cache.set(cacheKey, formattedSpeech, 15 * 60); // 15 minutes TTL
          } catch (error) {
            logger.debug(`Error setting cache for speech ${speechId}:`, error);
            // Continue even if caching fails
          }
        }
      }
      
      return formattedSpeech;
    } catch (error) {
      logger.error(`Error fetching transcript details for ${speechId}:`, error);
      throw error;
    }
  }

  /**
   * Search transcripts
   */
  async searchTranscripts(query: string): Promise<any[]> {
    if (!this.api) {
      await this.initializeApi();
    }
    
    try {
      const results = await this.api!.speechSearch(query);
      
      // Format the search results
      const formattedResults = results.map(result => {
        let createdAtFormatted;
        try {
          // Check if start_time is a valid timestamp
          if (result.start_time && !isNaN(result.start_time)) {
            createdAtFormatted = new Date(result.start_time * 1000).toISOString();
          } else {
            createdAtFormatted = new Date().toISOString(); // Use current date as fallback
            logger.warn(`Invalid start_time timestamp for search result ${result.speech_id}, using current date instead`);
          }
        } catch (error) {
          createdAtFormatted = new Date().toISOString(); // Use current date as fallback
          logger.warn(`Error formatting start_time for search result ${result.speech_id}: ${error.message}`);
        }
        
        return {
          speech_id: result.speech_id,
          title: result.title || "Untitled",
          created_at: createdAtFormatted,
          matches: result.matched_transcripts?.map(match => ({
            transcript_id: match.transcript_id,
            text: match.matched_transcript
          })) || []
        };
      });
      
      return formattedResults;
    } catch (error) {
      logger.error(`Error searching transcripts for "${query}":`, error);
      throw error;
    }
  }
}
