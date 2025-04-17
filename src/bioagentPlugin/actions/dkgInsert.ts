import dotenv from "dotenv";
dotenv.config();

import {
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
  ModelType,
  type HandlerCallback,
  type ActionExample,
  type Action,
  composePrompt,
} from "@elizaos/core";

import { DKG_EXPLORER_LINKS } from "../constants";
import { createDKGMemoryTemplate } from "../templates";
import fs from "fs/promises";
import axios from "axios";

import DKG from "dkg.js";

import { DKGMemorySchema, isDKGMemoryContent } from "../types";
import {
  processDocumentContent,
  PaperArrayElement,
  jsonArrToKa,
} from "../services/kaService/kaService";
import { storeJsonLd } from "../services/gdrive/storeJsonLdToKg";
import { makeUnstructuredApiRequest } from "../services/kaService/unstructuredPartitioning";

/**
 * Downloads a file from a URL and returns it as a Buffer
 * @param url The URL to download the file from
 * @returns A Buffer containing the file data
 */
async function downloadFileFromUrl(url: string): Promise<Buffer> {
  logger.debug(`Downloading file from URL: ${url}`);
  try {
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer'
    });
    
    // The response.data is now typed as ArrayBuffer
    const arrayBuffer = response.data;
    logger.debug(`Successfully downloaded file. Size: ${arrayBuffer.byteLength} bytes`);
    
    // Create a Buffer from the ArrayBuffer
    return Buffer.from(arrayBuffer);
  } catch (error) {
    logger.error(`Error downloading file from URL: ${(error as Error).message}`);
    throw error;
  }
}

// Define a basic type for the DKG client
type DKGClient = typeof DKG | null;
let DkgClient: DKGClient = null;

// Validation function to ensure API response is an array of PaperArrayElement
function validateUnstructuredResponse(response: unknown): PaperArrayElement[] {
  if (!Array.isArray(response)) {
    logger.error("Unstructured API response is not an array");
    return [];
  }

  return response.map((item) => {
    if (!item || typeof item !== "object") {
      return {
        metadata: { page_number: 1 },
        text: "",
        type: "NarrativeText",
      };
    }

    // Ensure metadata exists and has page_number
    let metadataObj = (item as any).metadata;
    if (!metadataObj || typeof metadataObj !== "object") {
      metadataObj = { page_number: 1 };
    } else if (!("page_number" in metadataObj)) {
      metadataObj = { ...metadataObj, page_number: 1 };
    }

    // Ensure text is a string
    let text = (item as any).text || "";
    if (typeof text !== "string") {
      text = String(text || "");
    }

    return {
      metadata: metadataObj,
      text,
      type: (item as any).type || "NarrativeText",
    };
  });
}

export const dkgInsert: Action = {
  name: "INSERT_MEMORY_ACTION",
  similes: [
    "NO_ACTION",
    "NO_RESPONSE",
    "NO_REACTION",
    "NONE",
    "DKG_INSERT",
    "INGEST_PAPER",
  ],
  validate: async (runtime: IAgentRuntime, _message: Memory) => {
    const requiredEnvVars = [
      "DKG_ENVIRONMENT",
      "DKG_HOSTNAME",
      "DKG_PORT",
      "DKG_BLOCKCHAIN_NAME",
      "DKG_PUBLIC_KEY",
      "DKG_PRIVATE_KEY",
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
    "Process a paper and create a discourse graph on the OriginTrail Decentralized Knowledge Graph.",
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

      let fileBuffer = null;
      let filename = "document.pdf";
      let isPdf = false;
      let isText = false;
      let textContent = "";

      // Debug: Log message structure
      logger.debug(`Message structure: ${JSON.stringify({
        id: message.id,
        contentType: typeof message.content,
        hasText: typeof message.content === "object" && "text" in message.content,
        hasAttachments: typeof message.content === "object" && ("attachments" in message.content || "attachment" in message.content),
        stateKeys: Object.keys(state)
      })}`);

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
        messageText.toLowerCase().includes("analyze") ||
        messageText.toLowerCase().includes("extract") ||
        messageText.toLowerCase().includes("document") ||
        messageText.toLowerCase().includes("text") ||
        messageText.toLowerCase().includes("read") ||
        messageText.toLowerCase().includes("parse") ||
        messageText.toLowerCase().includes("graph") ||
        messageText.toLowerCase().includes("knowledge") ||
        messageText.toLowerCase().includes("dkg");

      logger.info(`Is ingestion request: ${isIngestRequest}`);

      if (!isIngestRequest) {
        // Not an ingestion request
        logger.info(
          "Not detected as an ingestion request. No ingestion keywords found."
        );
        await callback({
          text: "This doesn't appear to be a paper ingestion request. Please attach a paper and ask to ingest it using keywords like 'ingest', 'process', etc.",
          source: message.content.source,
        });
        return true;
      }

      // Check for attachments in state
      const attachments = state.attachments || [];
      logger.info(`Attachments found in state: ${attachments.length}`);
      
      // Debug: Log state attachments details if any
      if (attachments.length > 0) {
        logger.debug(`State attachments details: ${JSON.stringify(attachments.map(att => {
          // Safely access properties with type checking
          const attObj = att as any;
          return {
            name: attObj.name,
            type: attObj.type,
            hasContent: !!attObj.content,
            contentType: attObj.content ? typeof attObj.content : 'none',
            hasPath: !!attObj.path,
            hasText: !!attObj.text,
            size: attObj.content ? (typeof attObj.content === 'string' ? attObj.content.length : 
                                  (Buffer.isBuffer(attObj.content) ? attObj.content.length : 'unknown')) : 'unknown'
          };
        }))}`);
      }

      // Also check for attachments in message.content
      if (message.content && typeof message.content === "object") {
        // Debug: Log message.content structure
        logger.debug(`Message content structure: ${JSON.stringify({
          keys: Object.keys(message.content),
          hasAttachments: "attachments" in message.content,
          hasAttachment: "attachment" in message.content,
          source: message.content.source
        })}`);
        
        if ("attachments" in message.content) {
          const msgAttachments = message.content.attachments || [];
          logger.info(`Attachments found in message content: ${msgAttachments.length}`);
          
          // Debug: Log message attachments details
          if (msgAttachments.length > 0) {
            logger.debug(`Message attachments details: ${JSON.stringify(msgAttachments.map(att => {
              // Safely access properties with type checking
              const attObj = att as any;
              return {
                name: attObj.name,
                type: attObj.type,
                hasContent: !!attObj.content,
                contentType: attObj.content ? typeof attObj.content : 'none',
                hasPath: !!attObj.path,
                hasText: !!attObj.text,
                size: attObj.content ? (typeof attObj.content === 'string' ? attObj.content.length : 
                                      (Buffer.isBuffer(attObj.content) ? attObj.content.length : 'unknown')) : 'unknown'
              };
            }))}`);
          }
          
          if (msgAttachments.length > 0 && attachments.length === 0) {
            attachments.push(...msgAttachments);
          }
        }
        
        if ("attachment" in message.content) {
          const singleAttachment = message.content.attachment;
          // Safely access properties with type checking
          const singleAttObj = singleAttachment as any;
          
          logger.info(`Single attachment found: ${JSON.stringify({
            name: singleAttObj?.name,
            type: singleAttObj?.type
          })}`);
          
          // Debug: Log single attachment details
          if (singleAttachment) {
            logger.debug(`Single attachment details: ${JSON.stringify({
              name: singleAttObj.name,
              type: singleAttObj.type,
              hasContent: !!singleAttObj.content,
              contentType: singleAttObj.content ? typeof singleAttObj.content : 'none',
              hasPath: !!singleAttObj.path,
              hasText: !!singleAttObj.text,
              size: singleAttObj.content ? (typeof singleAttObj.content === 'string' ? singleAttObj.content.length : 
                                          (Buffer.isBuffer(singleAttObj.content) ? singleAttObj.content.length : 'unknown')) : 'unknown'
            })}`);
          }
          
          if (singleAttachment && attachments.length === 0) {
            attachments.push(singleAttachment);
          }
        }
      }

      if (attachments.length === 0) {
        await callback({
          text: "I need an attached document (PDF or text) to process. Please attach a paper.",
          source: message.content.source,
        });
        return true;
      }

      // We'll just process the first attachment
      const attachment = attachments[0];
      logger.info(`Processing attachment: ${attachment.name || "unnamed file"}`);
      
      // Cast attachment to any to safely access properties
      const attachmentObj = attachment as any;
      
      // Debug: Log detailed attachment information
      logger.debug(`Attachment details: ${JSON.stringify({
        name: attachmentObj.name,
        type: attachmentObj.type,
        mimeType: attachmentObj.mimeType,
        isPdf: attachmentObj.type?.includes("pdf") || attachmentObj.name?.toLowerCase().endsWith(".pdf"),
        hasContent: !!attachmentObj.content,
        contentType: attachmentObj.content ? typeof attachmentObj.content : 'none',
        contentLength: attachmentObj.content ? (typeof attachmentObj.content === 'string' ? attachmentObj.content.length : 
                                               (Buffer.isBuffer(attachmentObj.content) ? attachmentObj.content.length : 'unknown')) : 'unknown',
        hasPath: !!attachmentObj.path,
        path: attachmentObj.path,
        hasText: !!attachmentObj.text,
        textLength: attachmentObj.text ? attachmentObj.text.length : 0,
        keys: Object.keys(attachmentObj)
      })}`);

      await callback({
        text: `Starting to process your document: ${attachment.name || "unnamed document"}...`,
        source: message.content.source,
      });

      // Determine if PDF or text
      if (
        attachment.type?.includes("pdf") ||
        attachment.name?.toLowerCase().endsWith(".pdf")
      ) {
        isPdf = true;
        filename = attachment.name || "document.pdf";

        // Enhanced check for Discord PDF with conversion failed
        const isDiscordConversionFailedPdf = 
          (attachmentObj.name && (
            attachmentObj.name.includes("PDF Attachment (conversion failed)") || 
            attachmentObj.name.includes("PDF Attachment") ||
            attachmentObj.name.includes("conversion failed")
          )) || 
          (attachmentObj.description && attachmentObj.description.includes("could not be converted to text")) ||
          (attachmentObj.text && attachmentObj.text.includes("This is a PDF attachment") && 
           attachmentObj.text.includes("conversion failed"));
        
        logger.debug(`Is Discord conversion failed PDF: ${isDiscordConversionFailedPdf}`);
        logger.debug(`Discord PDF detection details: ${JSON.stringify({
          name: attachmentObj.name,
          description: attachmentObj.description,
          text: attachmentObj.text ? attachmentObj.text.substring(0, 100) + '...' : 'none',
          url: attachmentObj.url
        })}`);
        
        // Extract filename from text if available
        let extractedFilename = null;
        if (attachmentObj.text && attachmentObj.text.includes("File name:")) {
          const filenameMatch = attachmentObj.text.match(/File name: ([^,]+),/);
          if (filenameMatch && filenameMatch[1]) {
            extractedFilename = filenameMatch[1].trim();
            logger.debug(`Extracted filename from text: ${extractedFilename}`);
            if (extractedFilename.toLowerCase().endsWith('.pdf')) {
              filename = extractedFilename;
            }
          }
        }
        
        // If it's a Discord conversion failed PDF, try to download it from the URL
        if (isDiscordConversionFailedPdf) {
          // Try to get URL from different possible locations
          const pdfUrl = attachmentObj.url || 
                        (attachmentObj.content && typeof attachmentObj.content === 'object' && attachmentObj.content.url) ||
                        (attachmentObj.attachment && attachmentObj.attachment.url);
          
          if (pdfUrl) {
            logger.info(`Detected Discord PDF with conversion failure. Attempting to download from URL: ${pdfUrl}`);
            try {
              fileBuffer = await downloadFileFromUrl(pdfUrl);
              logger.info(`Successfully downloaded PDF from Discord URL. Buffer length: ${fileBuffer.length}`);
            } catch (error) {
              logger.error(`Failed to download PDF from Discord URL: ${error.message}`);
            }
          } else {
            logger.error(`Discord PDF detected but no URL found to download from`);
            logger.debug(`Attachment structure: ${JSON.stringify(Object.keys(attachmentObj))}`);
          }
        }
        
        // If not a Discord conversion failed PDF or download failed, try normal methods
        if (!fileBuffer) {
          // If content is provided as base64 or buffer
          if (attachment.content) {
            logger.debug(`Attachment content type: ${typeof attachment.content}`);
            
            if (typeof attachment.content === "string") {
              logger.debug(`Converting string content to buffer. Content length: ${attachment.content.length}`);
              logger.debug(`Content starts with: ${attachment.content.substring(0, 50)}...`);
              
              try {
                fileBuffer = Buffer.from(attachment.content, "base64");
                logger.debug(`Successfully converted to buffer. Buffer length: ${fileBuffer.length}`);
              } catch (error) {
                logger.error(`Error converting string content to buffer: ${error.message}`);
              }
            } else if (Buffer.isBuffer(attachment.content)) {
              logger.debug(`Using existing buffer. Buffer length: ${attachment.content.length}`);
              fileBuffer = attachment.content;
            } else {
              logger.error(`Unexpected attachment.content type: ${typeof attachment.content}`);
              logger.debug(`Content structure: ${JSON.stringify(Object.keys(attachment.content))}`);
            }
          } else {
            logger.debug(`No attachment.content found`);
          }

          // If there's a file path
          if (!fileBuffer && attachment.path) {
            logger.debug(`Attempting to read file from path: ${attachment.path}`);
            try {
              fileBuffer = await fs.readFile(attachment.path);
              logger.debug(`Successfully read file from path. Buffer length: ${fileBuffer.length}`);
            } catch (error) {
              logger.error(`Error reading file from path: ${error.message}`);
              logger.debug(`File path details: ${JSON.stringify({
                path: attachment.path,
                exists: await fs.stat(attachment.path).catch(() => false) ? true : false
              })}`);
            }
          }
        }
        if (!fileBuffer) {
          logger.error(`Failed to obtain file buffer from attachment`);
          logger.debug(`Attachment processing summary: ${JSON.stringify({
            hadContent: !!attachment.content,
            contentType: attachment.content ? typeof attachment.content : 'none',
            hadPath: !!attachment.path,
            bufferCreated: !!fileBuffer
          })}`);
          
          await callback({
            text: "I couldn't process the PDF file. Please verify it was attached correctly.",
            source: message.content.source,
          });
          return false;
        } else {
          logger.debug(`Successfully obtained file buffer. Length: ${fileBuffer.length}, First 20 bytes: ${fileBuffer.slice(0, 20).toString('hex')}`);
        }
      } else if (attachment.text) {
        // Handle text-based attachments
        isText = true;
        textContent = attachment.text;
        filename = attachment.name || "document.txt";
      } else {
        await callback({
          text: "Unsupported file type. Please attach a PDF or text document.",
          source: message.content.source,
        });
        return false;
      }

      // Extract content
      await callback({
        text: "Extracting content from your document...",
        source: message.content.source,
      });

      let discourseGraph = null;

      if (isPdf && fileBuffer) {
        // Example "fake" random DOI
        const mockDoi = `10.${Math.floor(Math.random() * 9000) + 1000}/paper-${Date.now()}`;

        try {
          await callback({
            text: "Partitioning the PDF into sections...",
            source: message.content.source,
          });

          const apiKey = runtime.getSetting("UNSTRUCTURED_API_KEY");
          logger.debug(`Unstructured API Key: ${apiKey ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}` : 'not set'}`);
          
          if (!apiKey) {
            throw new Error("UNSTRUCTURED_API_KEY not set");
          }
          if (apiKey === "dummy") {
            throw new Error(
              "UNSTRUCTURED_API_KEY is set to dummy. Please provide a real key."
            );
          }

          logger.debug(`Making Unstructured API request with file: ${filename}, buffer length: ${fileBuffer.length}`);
          try {
            const rawResponse = await makeUnstructuredApiRequest(
              fileBuffer,
              filename,
              apiKey
            );
            logger.debug(`Received raw response from Unstructured API: ${typeof rawResponse}`);
            logger.debug(`Response is array: ${Array.isArray(rawResponse)}, Length: ${Array.isArray(rawResponse) ? rawResponse.length : 'N/A'}`);
            
            if (Array.isArray(rawResponse) && rawResponse.length > 0) {
              logger.debug(`First item type: ${typeof rawResponse[0]}`);
              logger.debug(`First item keys: ${Object.keys(rawResponse[0])}`);
              if (rawResponse[0].text) {
                logger.debug(`Sample text from first item: ${rawResponse[0].text.substring(0, 100)}...`);
              }
            }
            
            const unstructuredResponse = validateUnstructuredResponse(rawResponse);

          await callback({
            text: "Building the knowledge graph from extracted PDF content...",
            source: message.content.source,
          });

            logger.debug(`Validated response length: ${unstructuredResponse.length}`);
            
            discourseGraph = await jsonArrToKa(unstructuredResponse, mockDoi);
            logger.debug(`Generated discourse graph with ${Object.keys(discourseGraph).length} keys`);
            logger.debug(`Graph keys: ${Object.keys(discourseGraph)}`);
          } catch (error) {
            logger.error(`Error in Unstructured API request or processing: ${error.message}`);
            logger.debug(`Error stack: ${error.stack}`);
            throw error;
          }
        } catch (error) {
          logger.error(`Error processing PDF: ${error.message}`);
          await callback({
            text: `Error while processing the PDF: ${error.message}`,
            source: message.content.source,
          });
          return false;
        }
      } else if (isText) {
        // Process text directly
        try {
          await callback({
            text: "Processing text content...",
            source: message.content.source,
          });

          // You can still call an external partitioning service if you want,
          // or processDocumentContent can do it directly.
          const result = await processDocumentContent(textContent, DkgClient);
          discourseGraph = result;
          const usedFallback = result.usedFallback;

          if (usedFallback) {
            await callback({
              text: "⚠️ I couldn’t fully understand the structure of your document. I tried my best, but some parts may be missing or incomplete.",
              source: message.content.source,
            });
          }

          if (!discourseGraph) {
            throw new Error("Failed to generate a discourse graph from text");
          }
        } catch (error) {
          logger.error(`Error processing text: ${error.message}`);
          await callback({
            text: `Error while processing the text: ${error.message}`,
            source: message.content.source,
          });
          return false;
        }
      }

      if (!discourseGraph) {
        await callback({
          text: "Failed to generate a discourse graph.",
          source: message.content.source,
        });
        return false;
      }

      // 🛡️ SAFETY CHECK: Prevent uploading fallback or low-value data
      const title = discourseGraph["dcterms:title"] || discourseGraph["schema:name"] || "";
      const abstract = discourseGraph["dcterms:abstract"] || discourseGraph["schema:abstract"] || "";

      const isLikelyFallback =
        title.toLowerCase().includes("untitled") ||
        abstract.trim().length < 50 ||
        Object.keys(discourseGraph).length <= 5;

      if (isLikelyFallback) {
        logger.warn("🚫 Skipping DKG upload: Content appears to be fallback or lacks substance.");
        logger.debug(`Fallback check triggered for title: "${title}", abstract length: ${abstract.length}`);

        await callback({
          text: `⚠️ I couldn’t extract meaningful content from the document, so nothing was uploaded to the DKG.\nPlease try uploading a clearer or more complete version.`,
          source: message.content.source,
        });

        return false;
      }


      // Store the discourse graph in the DKG
      await callback({
        text: "Storing the discourse graph in the Decentralized Knowledge Graph...",
        source: message.content.source,
      });

      try {
        const { success, ual } = await storeJsonLd(discourseGraph, DkgClient);
        
        // Get environment and title regardless of success
        const environment = runtime.getSetting("DKG_ENVIRONMENT") || "devnet";
        const explorerLink = DKG_EXPLORER_LINKS[environment] || DKG_EXPLORER_LINKS.devnet;
        const title = discourseGraph["dcterms:title"] || "Processed paper";
        
        if (success && ual) {
          // Successfully stored with UAL
          let resultMessage = `✅ Successfully processed and stored the paper in the DKG!\n\n`;
          resultMessage += `**Title**: ${title}\n`;
          resultMessage += `**UAL**: ${ual}\n\n`;
          resultMessage += `View it on the DKG Explorer: ${explorerLink}/explore?ual=${encodeURIComponent(ual)}`;
      
          await callback({
            text: resultMessage,
            source: message.content.source,
          });
          return true;
        } else if (success) {
          // Successfully stored but no UAL returned
          let resultMessage = `✅ Successfully processed and stored the paper in the DKG!\n\n`;
          resultMessage += `**Title**: ${title}\n`;
          resultMessage += `\nThe paper was successfully stored, but no UAL was returned. `;
          resultMessage += `This may be due to a temporary issue with the DKG service.`;
      
          await callback({
            text: resultMessage,
            source: message.content.source,
          });
          return true;
        } else {
          throw new Error("Failed to store in DKG");
        }
      } catch (error) {
        logger.error(`Error storing discourse graph: ${error.message}`);
        await callback({
          text: `Error while storing the discourse graph: ${error.message}`,
          source: message.content.source,
        });
        return false;
      }
    } catch (error) {
      logger.error(`Error in dkgInsert action: ${error.message}`);
      await callback({
        text: `An error occurred while processing: ${error.message}`,
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
          text: "execute action DKG_INSERT",
          action: "DKG_INSERT",
        },
      },
      {
        name: "{{user2}}",
        content: { text: "DKG INSERT" },
      },
    ],
    [
      {
        user: "{{user1}}",
        content: { text: "add to dkg", action: "DKG_INSERT" },
      },
      {
        user: "{{user2}}",
        content: { text: "DKG INSERT" },
      },
    ],
    [
      {
        user: "{{user1}}",
        content: { text: "store in dkg", action: "DKG_INSERT" },
      },
      {
        user: "{{user2}}",
        content: { text: "DKG INSERT" },
      },
    ],
  ] as ActionExample[][],
};
