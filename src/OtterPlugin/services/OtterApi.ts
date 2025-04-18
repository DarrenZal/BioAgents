// File: services/OtterApi.ts
import axios from 'axios';
import { logger } from "@elizaos/core";
import { 
  OtterApiConfig, 
  OtterSpeech, 
  OtterTranscript, 
  OtterSearchResult 
} from "../types";

// Response types
interface LoginResponse {
  userid: string;
  [key: string]: any;
}

interface SpeechesResponse {
  speeches: OtterSpeech[];
  [key: string]: any;
}

interface SpeechResponse extends OtterSpeech {
  transcripts: OtterTranscript[];
  [key: string]: any;
}

interface SearchResponse {
  results: OtterSearchResult[];
  [key: string]: any;
}

interface FoldersResponse {
  folders: any[];
  [key: string]: any;
}

interface SpeakersResponse {
  speakers: any[];
  [key: string]: any;
}

export class OtterApi {
  private baseUrl: string = 'https://otter.ai/forward/api/v1';
  private email: string;
  private password: string;
  private accessToken: string | null = null;
  private userId: string | null = null;
  private cookies: Record<string, string> = {};
  private axiosInstance: any;

  constructor(config: OtterApiConfig) {
    this.email = config.email;
    this.password = config.password;
    this.axiosInstance = axios.create({});
  }

  /**
   * Initialize the API by logging in
   */
  async init(): Promise<void> {
    try {
      logger.info("Initializing Otter.ai API");
      logger.debug(`OtterApi.init: Using email: ${this.email.substring(0, 3)}...`);
      const loginUrl = `${this.baseUrl}/login`;
      
      // Configure axios to include auth
      this.axiosInstance = axios.create({
        auth: {
          username: this.email,
          password: this.password
        },
        withCredentials: true
      });
      
      // Make login request
      const response = await this.axiosInstance.get(loginUrl, {
        params: { username: this.email }
      });
      
      if (response.status !== 200) {
        throw new Error(`Login failed with status code: ${response.status}`);
      }
      
      // Store credentials and cookies
      this.userId = response.data.userid;
      logger.debug(`OtterApi.init: Login successful, got userId`);
      this.cookies = this.parseCookies(response.headers['set-cookie']);
      logger.debug(`OtterApi.init: Parsed cookies: ${Object.keys(this.cookies).join(', ')}`);
      
      logger.info("Otter.ai API initialized successfully");
    } catch (error) {
      logger.error("Error initializing Otter.ai API:", error);
      throw error;
    }
  }

  /**
   * Get all speeches
   */
  async getSpeeches(folder = 0, pageSize = 45, source = "owned"): Promise<OtterSpeech[]> {
    if (!this.userId) {
      throw new Error("Not logged in. Call init() first.");
    }
    
    try {
      logger.debug(`OtterApi.getSpeeches: Fetching speeches for user`);
      const url = `${this.baseUrl}/speeches`;
      logger.debug(`OtterApi.getSpeeches: Making request to ${url} with params: userid=${this.userId}, folder=${folder}, page_size=${pageSize}, source=${source}`);
      
      let response;
      try {
        response = await this.axiosInstance.get(url, {
          params: {
            userid: this.userId,
            folder,
            page_size: pageSize,
            source
          }
        });
        logger.debug(`OtterApi.getSpeeches: Request completed with status ${response.status}`);
      } catch (requestError) {
        logger.error("OtterApi.getSpeeches: Request failed:", requestError);
        if (requestError.response) {
          logger.error(`OtterApi.getSpeeches: Response status: ${requestError.response.status}`);
          logger.error(`OtterApi.getSpeeches: Response data:`, requestError.response.data);
        }
        throw new Error(`Failed to get speeches: ${requestError.message}`);
      }
      
      if (response.status !== 200) {
        throw new Error(`Failed to get speeches with status code: ${response.status}`);
      }
      
      const speeches = response.data.speeches || [];
      logger.debug(`OtterApi.getSpeeches: Fetched ${speeches.length} speeches`);
      
      return speeches;
    } catch (error) {
      logger.error("Error fetching speeches:", error);
      throw error;
    }
  }

  /**
   * Get a specific speech by ID
   */
  async getSpeech(speechId: string): Promise<{ speech: OtterSpeech, transcripts: OtterTranscript[] }> {
    if (!this.userId) {
      throw new Error("Not logged in. Call init() first.");
    }
    
    try {
      logger.debug(`OtterApi.getSpeech: Fetching speech with ID: ${speechId}`);
      logger.debug(`OtterApi.getSpeech: Request params: userid=${this.userId}, speech_id=${speechId}`);
      
      const response = await this.axiosInstance.get(`${this.baseUrl}/speech`, {
        params: {
          userid: this.userId,
          speech_id: speechId
        }
      });
      
      if (response.status !== 200) {
        throw new Error(`Failed to get speech with status code: ${response.status}`);
      }
      
      logger.debug(`OtterApi.getSpeech: Response status: ${response.status}`);
      logger.debug(`OtterApi.getSpeech: Response data keys: ${Object.keys(response.data).join(', ')}`);
      
      if (response.data.transcripts) {
        logger.debug(`OtterApi.getSpeech: Found ${response.data.transcripts.length} transcripts`);
      } else {
        logger.debug(`OtterApi.getSpeech: No transcripts found in response`);
      }
      
      // Log the full response data for debugging
      logger.debug(`OtterApi.getSpeech: Full response data: ${JSON.stringify(response.data, null, 2)}`);
      
      // The API response structure can vary:
      // 1. It might have transcripts directly in the response
      // 2. It might have transcripts in response.data
      // 3. It might have transcripts in response.data.speech
      // 4. It might not have transcripts at all and we need to fetch them separately
      
      const speechData = response.data.speech || response.data;
      let transcripts = [];
      
      // Check if transcripts are in the response
      if (response.data.transcripts && Array.isArray(response.data.transcripts)) {
        logger.debug(`OtterApi.getSpeech: Found ${response.data.transcripts.length} transcripts in response.data.transcripts`);
        transcripts = response.data.transcripts;
      } 
      // Check if transcripts are in the speech object
      else if (speechData.transcripts && Array.isArray(speechData.transcripts)) {
        logger.debug(`OtterApi.getSpeech: Found ${speechData.transcripts.length} transcripts in speechData.transcripts`);
        transcripts = speechData.transcripts;
      }
      // If no transcripts found, try to fetch them separately
      else {
        const speechIdFromResponse = speechData.speech_id || speechData.otid;
        
        if (speechIdFromResponse) {
          try {
            logger.debug(`OtterApi.getSpeech: No transcripts found in response, attempting to fetch them separately for speech ${speechIdFromResponse}`);
            
            // Make a separate request to get the transcripts
            const transcriptsResponse = await this.axiosInstance.get(`${this.baseUrl}/transcripts`, {
              params: {
                userid: this.userId,
                speech_id: speechIdFromResponse
              }
            });
            
            logger.debug(`OtterApi.getSpeech: Transcripts response status: ${transcriptsResponse.status}`);
            
            if (transcriptsResponse.status === 200 && transcriptsResponse.data.transcripts) {
              logger.debug(`OtterApi.getSpeech: Successfully fetched ${transcriptsResponse.data.transcripts.length} transcripts separately`);
              transcripts = transcriptsResponse.data.transcripts;
            }
          } catch (transcriptsError) {
            logger.error(`OtterApi.getSpeech: Error fetching transcripts separately:`, transcriptsError);
            // Continue with empty transcripts
          }
        }
      }
      
      logger.debug(`OtterApi.getSpeech: Returning speech data with ${transcripts.length} transcripts`);
      
      return {
        speech: speechData,
        transcripts: transcripts
      };
    } catch (error) {
      logger.error(`Error fetching speech ${speechId}:`, error);
      throw error;
    }
  }

  /**
   * Search for speeches matching a query
   */
  async speechSearch(query: string, pageSize = 10): Promise<OtterSearchResult[]> {
    if (!this.userId) {
      throw new Error("Not logged in. Call init() first.");
    }
    
    try {
      const response = await this.axiosInstance.get(`${this.baseUrl}/search`, {
        params: {
          userid: this.userId,
          query,
          page_size: pageSize
        }
      });
      
      if (response.status !== 200) {
        throw new Error(`Search failed with status code: ${response.status}`);
      }
      
      return response.data.results || [];
    } catch (error) {
      logger.error(`Error searching speeches for "${query}":`, error);
      throw error;
    }
  }

  /**
   * Download speech as transcript
   */
  async downloadSpeech(speechId: string, format = "txt"): Promise<string> {
    if (!this.userId || !this.cookies.csrftoken) {
      throw new Error("Not logged in or missing CSRF token. Call init() first.");
    }
    
    try {
      const response = await this.axiosInstance.post(
        `${this.baseUrl}/bulk_export`,
        {
          formats: format,
          speech_id_list: [speechId]
        },
        {
          params: { userid: this.userId },
          headers: {
            'x-csrftoken': this.cookies.csrftoken,
            'referer': 'https://otter.ai/'
          },
          responseType: 'arraybuffer'
        }
      );
      
      if (response.status !== 200) {
        throw new Error(`Download failed with status code: ${response.status}`);
      }
      
      // Convert response data to text
      // Using a simple string conversion for the array buffer
      return typeof response.data === 'string' 
        ? response.data 
        : JSON.stringify(response.data);
    } catch (error) {
      logger.error(`Error downloading speech ${speechId}:`, error);
      throw error;
    }
  }

  /**
   * Get list of folders
   */
  async getFolders(): Promise<any[]> {
    if (!this.userId) {
      throw new Error("Not logged in. Call init() first.");
    }
    
    try {
      const response = await this.axiosInstance.get(`${this.baseUrl}/folders`, {
        params: { userid: this.userId }
      });
      
      if (response.status !== 200) {
        throw new Error(`Failed to get folders with status code: ${response.status}`);
      }
      
      return response.data.folders || [];
    } catch (error) {
      logger.error("Error fetching folders:", error);
      throw error;
    }
  }

  /**
   * Get speakers
   */
  async getSpeakers(): Promise<any[]> {
    if (!this.userId) {
      throw new Error("Not logged in. Call init() first.");
    }
    
    try {
      const response = await this.axiosInstance.get(`${this.baseUrl}/speakers`, {
        params: { userid: this.userId }
      });
      
      if (response.status !== 200) {
        throw new Error(`Failed to get speakers with status code: ${response.status}`);
      }
      
      return response.data.speakers || [];
    } catch (error) {
      logger.error("Error fetching speakers:", error);
      throw error;
    }
  }

  /**
   * Helper method to parse cookies from response headers
   */
  private parseCookies(cookieHeader: string[] | undefined): Record<string, string> {
    const cookies: Record<string, string> = {};
    
    if (!cookieHeader || !Array.isArray(cookieHeader)) {
      return cookies;
    }
    
    cookieHeader.forEach(cookie => {
      const parts = cookie.split(';')[0].trim().split('=');
      if (parts.length === 2) {
        cookies[parts[0]] = parts[1];
      }
    });
    
    return cookies;
  }
}

export default OtterApi;
