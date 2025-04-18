// File: types.ts
import { z } from "zod";

// Otter API Types
export interface OtterApiConfig {
  email: string;
  password: string;
}

export interface OtterSpeech {
  speech_id: string;
  title: string;
  summary?: string;
  created_at: number;
  duration: number;
  transcript_updated_at: number;
  process_finished: boolean;
  upload_finished: boolean;
  [key: string]: any;
}

export interface OtterTranscript {
  id: number;
  transcript: string;
  start_offset: number;
  end_offset: number;
  speaker_id: string | null;
  speaker_model_label: string | null;
  created_at: string;
  [key: string]: any;
}

export interface OtterSearchResult {
  speech_id: string;
  title: string;
  matched_transcripts: Array<{
    transcript_id: number;
    matched_transcript: string;
    highlight_spans: any[];
  }>;
  [key: string]: any;
}

// Formatted response types
export interface FormattedSpeech {
  speech_id: string;
  title: string;
  summary?: string;
  created_at: string;
  duration: number;
  has_summary: boolean;
  has_transcript: boolean;
  transcription_progress: number;
}

export interface FormattedTranscriptParagraph {
  speaker_id: string | null;
  speaker_name: string | null;
  text: string;
  start_time: number;
  end_time: number;
}

export interface FormattedTranscriptDetail {
  otid: string;
  title: string;
  summary?: string;
  created_at: string;
  processing_status: string;
  transcript: {
    paragraphs: FormattedTranscriptParagraph[];
  };
}

export interface FormattedSearchResult {
  speech_id: string;
  title: string;
  created_at: string;
  matches: Array<{
    transcript_id: number;
    text: string;
  }>;
}

// Context provider types
export interface OtterTranscriptsContext {
  recentTranscripts: FormattedSpeech[];
  totalTranscripts: number;
  transcriptsWithSummaries: number;
}
