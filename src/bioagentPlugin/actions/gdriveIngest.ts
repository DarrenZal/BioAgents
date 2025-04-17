import dotenv from "dotenv";
dotenv.config();

import {
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
  type HandlerCallback,
  type ActionExample,
  type Action,
} from "@elizaos/core";

import { DKG_EXPLORER_LINKS } from "../constants";
import fs from "fs/promises";
import axios from "axios";
import DKG from "dkg.js";
import { initDriveClient, getListFilesQuery } from "../services/gdrive/client";
import { drive_v3 } from "googleapis";
import { fileMetadataTable } from "src/db";
import { eq } from "drizzle-orm";
import { generateKaFromPdf, generateKaFromPdfBuffer } from "../services/kaService/kaService";
import { storeJsonLd } from "../services/gdrive/storeJsonLdToKg";

// Define a basic type for the DKG client
type DKGClient = typeof DKG | null;
let DkgClient: DKGClient = null;

/**
 * Downloads a file from Google Drive by ID
 * @param fileId The ID of the file to download
 * @param drive The Google Drive client
 * @returns A Buffer containing the file data
 */
async function downloadFileFromDrive(fileId: string, drive: drive_v3.Drive): Promise<Buffer> {
  logger.debug(`Downloading file from Google Drive: ${fileId}`);
  try {
    const response = await drive.files.get(
      {
        fileId,
        alt: 'media'
      },
      { responseType: 'arraybuffer' }
    );
    
    // The response.data is now typed as ArrayBuffer
    const arrayBuffer = response.data as unknown as ArrayBuffer;
    logger.debug(`Successfully downloaded file. Size: ${arrayBuffer.byteLength} bytes`);
    
    // Create a Buffer from the ArrayBuffer
    return Buffer.from(arrayBuffer);
  } catch (error) {
    logger.error(`Error downloading file from Google Drive: ${(error as Error).message}`);
    throw error;
  }
}

export const gdriveIngest: Action = {
  name: "GDRIVE_INGEST_ACTION",
  similes: [
    "NO_ACTION",
    "NO_RESPONSE",
    "NO_REACTION",
    "NONE",
    "GDRIVE_INGEST",
    "INGEST_PAPERS",
    "PROCESS_DRIVE",
  ],
  validate: async (runtime: IAgentRuntime, _message: Memory) => {
    const requiredEnvVars = [
      "DKG_ENVIRONMENT",
      "DKG_HOSTNAME",
      "DKG_PORT",
      "DKG_BLOCKCHAIN_NAME",
      "DKG_PUBLIC_KEY",
      "DKG_PRIVATE_KEY",
      "GOOGLE_DRIVE_FOLDER_ID",
      "UNSTRUCTURED_API_KEY",
    ];

    const missingVars = requiredEnvVars.filter(
      (varName) => !runtime.getSetting(varName)
    );

    if (missingVars.length > 0) {
      logger.error(
        `Missing required environment variables: ${missingVars.join(", ")}`
      );
      return false;
    }

    return true;
  },
  description:
    "Process papers from Google Drive and create discourse graphs on the OriginTrail Decentralized Knowledge Graph.",
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    _options: { [key: string]: unknown },
    callback: HandlerCallback
  ): Promise<boolean> => {
    try {
      // Initialize DKG client
      DkgClient = new DKG({
        environment: runtime.getSetting("DKG_ENVIRONMENT"),
        endpoint: runtime.getSetting("DKG_HOSTNAME"),
        port: runtime.getSetting("DKG_PORT"),
        blockchain: {
          name: runtime.getSetting("DKG_BLOCKCHAIN_NAME"),
          publicKey: runtime.getSetting("DKG_PUBLIC_KEY"),
          privateKey: runtime.getSetting("DKG_PRIVATE_KEY"),
        },
        maxNumberOfRetries: 300,
        frequency: 2,
        contentType: "all",
        nodeApiVersion: "/v1",
      });

      // Check message text for ingestion trigger
      const messageText =
        typeof message.content === "string"
          ? message.content
          : message.content.text || "";

      logger.info(`Message text: "${messageText}"`);

      const isIngestRequest =
        messageText.toLowerCase().includes("ingest") ||
        messageText.toLowerCase().includes("process") ||
        messageText.toLowerCase().includes("paper") ||
        messageText.toLowerCase().includes("google drive") ||
        messageText.toLowerCase().includes("gdrive") ||
        messageText.toLowerCase().includes("drive");

      logger.info(`Is Google Drive ingestion request: ${isIngestRequest}`);

      if (!isIngestRequest) {
        // Not an ingestion request
        logger.info(
          "Not detected as a Google Drive ingestion request. No ingestion keywords found."
        );
        await callback({
          text: "This doesn't appear to be a Google Drive paper ingestion request. Please ask to ingest papers from Google Drive using keywords like 'ingest', 'process', 'google drive', etc.",
          source: message.content.source,
        });
        return true;
      }

      await callback({
        text: "Starting to process papers from Google Drive...",
        source: message.content.source,
      });

      // Initialize Google Drive client
      const drive = await initDriveClient([
        "https://www.googleapis.com/auth/drive.readonly",
      ]);

      // Get list of PDF files from Google Drive
      const query = getListFilesQuery();
      const response = await drive.files.list(query);
      const files = response.data.files || [];

      logger.info(`Found ${files.length} PDF files in Google Drive`);

      if (files.length === 0) {
        await callback({
          text: "No PDF files found in the configured Google Drive folder.",
          source: message.content.source,
        });
        return true;
      }

      await callback({
        text: `Found ${files.length} PDF files in Google Drive. Checking for new or updated files...`,
        source: message.content.source,
      });

      // Check which files are new or updated
      let newFiles = 0;
      let processedFiles = 0;
      let failedFiles = 0;
      let skippedFiles = 0;
      const successfulUALs: { name: string; ual: string }[] = [];

      for (const file of files) {
        if (!file.id || !file.name || !file.md5Checksum) {
          logger.warn(`Skipping file with missing metadata: ${file.name || 'unknown'}`);
          skippedFiles++;
          continue;
        }

        // Check if file has already been processed
        const fileExists = await runtime.db
          .select()
          .from(fileMetadataTable)
          .where(eq(fileMetadataTable.hash, file.md5Checksum));

        if (fileExists.length > 0) {
          logger.info(`File ${file.name} already processed, skipping`);
          skippedFiles++;
          continue;
        }

        newFiles++;
        
        try {
          await callback({
            text: `Processing file ${newFiles}/${files.length - skippedFiles}: ${file.name}...`,
            source: message.content.source,
          });

          // Download the file
          const pdfBuffer = await downloadFileFromDrive(file.id, drive);
          
          await callback({
            text: `Extracting content from "${file.name}"...`,
            source: message.content.source,
          });
          
          // Process the PDF and generate knowledge assembly
          const ka = await generateKaFromPdfBuffer(pdfBuffer, runtime);
          
          await callback({
            text: `Building knowledge graph for "${file.name}"...`,
            source: message.content.source,
          });
          
          // Check if the knowledge assembly has a title
          const title = ka["dcterms:title"] || ka["schema:name"] || file.name;
          
          // Store the knowledge assembly in the DKG
          const { success, ual } = await storeJsonLd(ka, DkgClient);
          
          if (success && ual) {
            // Record successful processing
            await runtime.db
              .insert(fileMetadataTable)
              .values({
                id: file.id,
                hash: file.md5Checksum,
                fileName: file.name,
                fileSize: Number(file.size || 0),
                modifiedAt: new Date(),
                ual: ual
              });
            
            processedFiles++;
            successfulUALs.push({ name: file.name, ual });
            
            await callback({
              text: `✅ Successfully processed and stored "${title}" in the DKG with UAL: ${ual}`,
              source: message.content.source,
            });
          } else {
            failedFiles++;
            logger.error(`Failed to store ${file.name} in DKG`);
            
            await callback({
              text: `❌ Failed to store "${file.name}" in the DKG.`,
              source: message.content.source,
            });
          }
        } catch (error) {
          failedFiles++;
          logger.error(`Error processing file ${file.name}: ${error.message}`);
          
          await callback({
            text: `❌ Error processing "${file.name}": ${error.message}`,
            source: message.content.source,
          });
        }
      }

      // Final summary
      const environment = runtime.getSetting("DKG_ENVIRONMENT") || "devnet";
      const explorerLink = DKG_EXPLORER_LINKS[environment] || DKG_EXPLORER_LINKS.devnet;
      
      let resultMessage = `📊 Google Drive Ingestion Summary:\n\n`;
      resultMessage += `- Total PDF files found: ${files.length}\n`;
      resultMessage += `- New files processed: ${newFiles}\n`;
      resultMessage += `- Successfully stored in DKG: ${processedFiles}\n`;
      resultMessage += `- Failed to process: ${failedFiles}\n`;
      resultMessage += `- Skipped (already processed): ${skippedFiles}\n\n`;
      
      if (successfulUALs.length > 0) {
        resultMessage += `Successfully processed papers:\n`;
        successfulUALs.forEach(({ name, ual }) => {
          resultMessage += `- "${name}": ${explorerLink}/explore?ual=${encodeURIComponent(ual)}\n`;
        });
      } else if (skippedFiles > 0 && newFiles === 0) {
        resultMessage += `All papers in the Google Drive have already been processed. No new papers to ingest.\n`;
      }
      
      await callback({
        text: resultMessage,
        source: message.content.source,
      });
      
      return true;
    } catch (error) {
      logger.error(`Error in gdriveIngest action: ${error.message}`);
      await callback({
        text: `An error occurred while processing papers from Google Drive: ${error.message}`,
        source: message.content.source,
      });
      return false;
    }
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "ingest papers from Google Drive",
          action: "GDRIVE_INGEST",
        },
      },
      {
        name: "{{user2}}",
        content: { text: "GDRIVE INGEST" },
      },
    ],
    [
      {
        user: "{{user1}}",
        content: { text: "process papers in gdrive", action: "GDRIVE_INGEST" },
      },
      {
        user: "{{user2}}",
        content: { text: "GDRIVE INGEST" },
      },
    ],
    [
      {
        user: "{{user1}}",
        content: { text: "add google drive papers to dkg", action: "GDRIVE_INGEST" },
      },
      {
        user: "{{user2}}",
        content: { text: "GDRIVE INGEST" },
      },
    ],
  ] as ActionExample[][],
};
