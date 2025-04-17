import axios from "axios";
import FormData from "form-data";
import fs from "fs/promises";
import "dotenv/config";
import { logger } from "@elizaos/core";

const apiKey = process.env.UNSTRUCTURED_API_KEY;

/**
 * Makes a POST request to the Unstructured API.
 *
 * @param fileBytes - The file content as a Buffer.
 * @param filename - Name of the file.
 * @param apiKey - Unstructured API key.
 * @returns The parsed API response.
 */
export async function makeUnstructuredApiRequest(
  fileBytes: Buffer,
  filename: string,
  apiKey: string
) {
  const url = "https://api.unstructuredapp.io/general/v0/general";

  // Debug: Log file buffer details
  logger.debug(`Unstructured API request details:
  - Filename: ${filename}
  - Buffer length: ${fileBytes.length} bytes
  - Buffer is valid: ${Buffer.isBuffer(fileBytes)}
  - First 20 bytes: ${fileBytes.slice(0, 20).toString('hex')}
  - File signature (magic number): ${fileBytes.slice(0, 4).toString('hex')}
  - API Key: ${apiKey ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}` : 'not set'}
  `);

  // Check if buffer appears to be a valid PDF (starts with %PDF)
  const isPdfSignature = fileBytes.slice(0, 4).toString() === '%PDF';
  logger.debug(`File appears to be a valid PDF: ${isPdfSignature}`);
  
  if (!isPdfSignature) {
    logger.warn(`File does not have a PDF signature. First 20 bytes: ${fileBytes.slice(0, 20).toString()}`);
  }

  // Create a FormData instance and append file and other data.
  const formData = new FormData();
  try {
    formData.append("files", fileBytes, filename);
    logger.debug(`Successfully appended file to FormData`);
    
    formData.append("pdf_infer_table_structure", "true");
    formData.append("skip_infer_table_types", "[]");
    formData.append("strategy", "hi_res");
    
    logger.debug(`FormData created with all parameters`);
  } catch (error) {
    logger.error(`Error creating FormData: ${error.message}`);
    logger.debug(`Error stack: ${(error as Error).stack}`);
    throw error;
  }

  // Merge the custom header with form-data headers.
  const headers = {
    "unstructured-api-key": apiKey,
    ...formData.getHeaders(),
  };
  
  logger.debug(`Request headers: ${JSON.stringify(headers)}`);

  logger.info("Making Unstructured API request");
  try {
    const response = await axios.post(url, formData, {
      headers,
      timeout: 300000, // 300000 ms (5 minutes)
    });

    logger.info(`Got response from Unstructured API with status: ${response.status}`);
    logger.debug(`Response headers: ${JSON.stringify(response.headers)}`);
    
    // Debug response data
    if (response.data) {
      logger.debug(`Response is array: ${Array.isArray(response.data)}`);
      logger.debug(`Response length: ${Array.isArray(response.data) ? response.data.length : 'N/A'}`);
      
      if (Array.isArray(response.data) && response.data.length > 0) {
        logger.debug(`First item type: ${typeof response.data[0]}`);
        logger.debug(`First item keys: ${Object.keys(response.data[0])}`);
        
        // Log a sample of the first item's text if available
        if (response.data[0].text) {
          logger.debug(`Sample text from first item: ${response.data[0].text.substring(0, 100)}...`);
        }
      } else if (!Array.isArray(response.data)) {
        logger.error(`Unexpected response format: ${typeof response.data}`);
        logger.debug(`Response data keys: ${Object.keys(response.data)}`);
      }
    } else {
      logger.error(`Empty response data received from Unstructured API`);
    }
    
    return response.data;
  } catch (error) {
    logger.error(`Error making Unstructured API request: ${(error as Error).message}`);
    
    // Log detailed error information
    if (error && typeof error === 'object' && 'isAxiosError' in error && error.isAxiosError) {
      logger.error(`Axios error: ${error.code}`);
      
      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        logger.error(`Response status: ${error.response.status}`);
        logger.error(`Response headers: ${JSON.stringify(error.response.headers)}`);
        logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
      } else if (error.request) {
        // The request was made but no response was received
        logger.error(`No response received. Request: ${JSON.stringify(error.request)}`);
      } else {
        // Something happened in setting up the request that triggered an Error
        logger.error(`Error setting up request: ${error.message}`);
      }
      
      logger.error(`Error config: ${JSON.stringify(error.config)}`);
    }
    
    logger.debug(`Error stack: ${(error as Error).stack}`);
    throw error;
  }
}

// async function processPdfFiles(): Promise<void> {
//   try {
//     const arxivPdfBuffer = await fs.readFile("arxiv_paper.pdf");
//     const bioArxivPdfBuffer = await fs.readFile("biorxiv_paper.pdf");

//     const arxivResponse = await makeUnstructuredApiRequest(
//       arxivPdfBuffer,
//       "arxiv_paper.pdf",
//       apiKey
//     );
//     console.log("Response for arxiv_paper.pdf:", arxivResponse);
//     await fs.writeFile(
//       "arxiv_paper.json",
//       JSON.stringify(arxivResponse, null, 2)
//     );

//     const bioArxivResponse = await makeUnstructuredApiRequest(
//       bioArxivPdfBuffer,
//       "biorxiv_paper.pdf",
//       apiKey
//     );
//     console.log("Response for biorxiv_paper.pdf:", bioArxivResponse);
//     await fs.writeFile(
//       "biorxiv_paper.json",
//       JSON.stringify(bioArxivResponse, null, 2)
//     );
//   } catch (error) {
//     console.error("Error processing PDF files:", error);
//   }
// }

// processPdfFiles();
