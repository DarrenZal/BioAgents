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

import DKG from "dkg.js";

import { DKGMemorySchema, isDKGMemoryContent } from "../types";
import {
  processDocumentContent,
  PaperArrayElement,
  jsonArrToKa,
} from "../services/kaService/kaService";
import { storeJsonLd } from "../services/gdrive/storeJsonLdToKg";
import { makeUnstructuredApiRequest } from "../services/kaService/unstructuredPartitioning";

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

      // Also check for attachments in message.content
      if (message.content && typeof message.content === "object") {
        if ("attachments" in message.content) {
          const msgAttachments = message.content.attachments || [];
          logger.info(`Attachments found in message content: ${msgAttachments.length}`);
          if (msgAttachments.length > 0 && attachments.length === 0) {
            attachments.push(...msgAttachments);
          }
        }
        if ("attachment" in message.content) {
          const singleAttachment = message.content.attachment;
          logger.info(`Single attachment found: ${singleAttachment}`);
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

        // If content is provided as base64 or buffer
        if (attachment.content) {
          if (typeof attachment.content === "string") {
            fileBuffer = Buffer.from(attachment.content, "base64");
          } else if (Buffer.isBuffer(attachment.content)) {
            fileBuffer = attachment.content;
          }
        }

        // If there's a file path
        if (!fileBuffer && attachment.path) {
          try {
            fileBuffer = await fs.readFile(attachment.path);
          } catch (error) {
            logger.error(`Error reading file from path: ${error.message}`);
          }
        }
        if (!fileBuffer) {
          await callback({
            text: "I couldn't process the PDF file. Please verify it was attached correctly.",
            source: message.content.source,
          });
          return false;
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
          if (!apiKey) {
            throw new Error("UNSTRUCTURED_API_KEY not set");
          }
          if (apiKey === "dummy") {
            throw new Error(
              "UNSTRUCTURED_API_KEY is set to dummy. Please provide a real key."
            );
          }

          const rawResponse = await makeUnstructuredApiRequest(
            fileBuffer,
            filename,
            apiKey
          );
          const unstructuredResponse = validateUnstructuredResponse(rawResponse);

          await callback({
            text: "Building the knowledge graph from extracted PDF content...",
            source: message.content.source,
          });

          discourseGraph = await jsonArrToKa(unstructuredResponse, mockDoi);
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
          discourseGraph = await processDocumentContent(textContent, DkgClient);

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
