// File: constants.ts

// Default settings
export const DEFAULT_SETTINGS = {
  // Max number of transcripts to fetch in a listing
  MAX_TRANSCRIPTS_TO_FETCH: 10,
  
  // Cache settings
  CACHE_ENABLED: true,
  CACHE_TTL_MS: 15 * 60 * 1000, // 15 minutes
  
  // Debug settings
  DEBUG_MODE: false,
};

// Cache keys
export const CACHE_KEYS = {
  SPEECHES_LIST: 'otter:speeches:list',
  SPEECH_DETAIL: (id: string) => `otter:speech:${id}`,
  SEARCH_RESULTS: (query: string) => `otter:search:${query}`,
};

// Error messages
export const ERROR_MESSAGES = {
  LOGIN_FAILED: "Failed to login to Otter.ai. Please check your credentials.",
  SERVICE_NOT_FOUND: "Otter.ai service not found. Make sure the plugin is properly initialized.",
  API_ERROR: "Error communicating with Otter.ai API.",
  TRANSCRIPT_NOT_FOUND: "Transcript not found. Please check the ID and try again.",
  NO_TRANSCRIPTS: "No transcripts found in your Otter.ai account.",
  NO_SUMMARIES: "No meeting summaries found in your Otter.ai account.",
};

// Helper functions for formatting
export const formatDate = (timestamp: number | string): string => {
  let date: Date;
  
  if (typeof timestamp === 'number') {
    date = new Date(timestamp * 1000); // Convert Unix timestamp (seconds) to milliseconds
  } else {
    date = new Date(timestamp);
  }
  
  return date.toLocaleString();
};

export const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  
  const parts = [];
  
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  
  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`);
  }
  
  parts.push(`${remainingSeconds}s`);
  
  return parts.join(' ');
};
