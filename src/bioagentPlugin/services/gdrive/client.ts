// https://developers.google.com/workspace/drive/api/reference/rest/v3

import { google, drive_v3 } from "googleapis";
import { ListFilesQueryContext } from "./buildQuery";
import "dotenv/config";
import fs from 'fs';  

/**
 * Initialize and return a Google Drive client
 * @param scopes - The OAuth scopes to request
 * @returns The initialized Google Drive client
 */
export async function initDriveClient(
  scopes: string[] = ["https://www.googleapis.com/auth/drive.readonly"]
): Promise<drive_v3.Drive> {
  let credentials: any;
  try {
    // Load credentials
    let credentials: any;
    const credsEnv = process.env.GCP_JSON_CREDENTIALS;
    const credsPath = process.env.GCP_CREDENTIALS_PATH;
    
    if (credsEnv && credsEnv.trim()) {
      credentials = JSON.parse(credsEnv);
    } else if (credsPath) {
      credentials = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    } else {
      throw new Error("No Google credentials found. Set either GCP_JSON_CREDENTIALS or GCP_CREDENTIALS_PATH");
    }
    // Set up authentication
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes,
    });

    // Create and return drive client
    return google.drive({ version: "v3", auth });
  } catch (error) {
    console.error("Error initializing Google Drive client:", error);
    throw error;
  }
}

export const FOLDERS = {
  SHARED_DRIVE_FOLDER: process.env.GOOGLE_DRIVE_FOLDER_ID,
  SHARED_DRIVE_ID: process.env.SHARED_DRIVE_ID,
};

export function getListFilesQuery() {
  const context = new ListFilesQueryContext(
    FOLDERS.SHARED_DRIVE_FOLDER,
    FOLDERS.SHARED_DRIVE_ID
  );
  return context.buildQuery();
}

export function getStartPageTokenParams() {
  const context = new ListFilesQueryContext(
    FOLDERS.SHARED_DRIVE_FOLDER,
    FOLDERS.SHARED_DRIVE_ID
  );
  return context.getStartPageTokenParams();
}
