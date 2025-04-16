import "dotenv/config";
import { getClient } from "./anthropicClient";
import { downloadPaperAndExtractDOI } from "./downloadPaper";
import { paperExists } from "./sparqlQueries";
import { logger } from "@elizaos/core";
import { makeUnstructuredApiRequest } from "./unstructuredPartitioning";
import crypto from "crypto";
import { processJsonArray, process_paper, create_graph } from "./processPaper";
import { getSummary } from "./vectorize";
import { fromBuffer, fromPath } from "pdf2pic";
import fs from "fs";
import { categorizeIntoDAOsPrompt } from "./llmPrompt";
import DKG from "dkg.js";
import { generateResponse } from "./anthropicClient";
import { IAgentRuntime } from "@elizaos/core";

const unstructuredApiKey = process.env.UNSTRUCTURED_API_KEY;

type DKGClient = typeof DKG | null;

// const jsonArr = JSON.parse(fs.readFileSync('arxiv_paper.json', 'utf8'));

export interface PaperArrayElement {
  metadata: {
    page_number: number;
    [key: string]: unknown;
  };
  text: string;
  type?: string;  // Added optional type field
  [key: string]: unknown;
}

interface TaskInstance {
  xcom_push(key: string, value: string): void;
}

export interface GeneratedGraph {
  "@context": Record<string, string>;
  "@id"?: string;
  "@type"?: string;
  "dcterms:title"?: string;
  "dcterms:hasPart"?: string;
  "dcterms:creator"?: unknown;
  "dcterms:abstract"?: string;
  "cito:cites"?: unknown;
  [key: string]: unknown;
}

export const defaultContext: Record<string, string> = {
  "dcterms": "http://purl.org/dc/terms/",
  "fabio": "http://purl.org/spar/fabio/",
  "cito": "http://purl.org/spar/cito/",
  "foaf": "http://xmlns.com/foaf/0.1/",
  "schema": "http://schema.org/",
  "doco": "http://purl.org/spar/doco/",
  "bibo": "http://purl.org/ontology/bibo/"
};

/**
 * Takes an array of JSON elements representing the paper's text
 * and returns a "knowledge assembly" (semantic graph) that includes
 * extracted metadata, citation info, subgraphs, and a summary.
 */
export async function jsonArrToKa(jsonArr: PaperArrayElement[], doi: string): Promise<GeneratedGraph> {
  logger.info(`Starting jsonArrToKa with ${jsonArr.length} elements and DOI: ${doi}`);
  
  const client = getClient();

  try {
    logger.info("Processing JSON array");
    const paperArrayDict = await processJsonArray(jsonArr, client);
    logger.info("JSON array processed successfully");

    logger.info("Processing paper");
    const [
      generatedBasicInfo,
      generatedCitations,
      generatedGoSubgraph,
      generatedDoidSubgraph,
      generatedChebiSubgraph,
      generatedAtcSubgraph,
    ] = await process_paper(client, paperArrayDict);
    logger.info("Paper processed successfully");

    // Get the raw result from create_graph
    logger.info("Creating graph");
    const graphResult = await create_graph(
      client,
      generatedBasicInfo,
      generatedCitations,
      {
        go: generatedGoSubgraph,
        doid: generatedDoidSubgraph,
        chebi: generatedChebiSubgraph,
        atc: generatedAtcSubgraph,
      }
    );
    logger.info("Graph created successfully");
  
  // Ensure we have a valid @context by checking its type and structure
  let contextValue: Record<string, string>;
  
  if (graphResult["@context"] && 
      typeof graphResult["@context"] === 'object' && 
      !Array.isArray(graphResult["@context"])) {
    // Try to use the existing context if it's an object (not an array)
    try {
      // Create a safe typed copy
      contextValue = Object.entries(graphResult["@context"]).reduce((acc, [key, value]) => {
        // Only include string values
        if (typeof value === 'string') {
          acc[key] = value;
        }
        return acc;
      }, {} as Record<string, string>);
    } catch (error) {
      // Fallback to default context if any issues
      logger.warn("Error processing @context, using default", error);
      contextValue = { ...defaultContext };
    }
  } else {
    // Use default context if @context is missing or not an object
    contextValue = { ...defaultContext };
  }
  
  // Ensure schema is in the context
  if (!("schema" in contextValue)) {
    contextValue["schema"] = "http://schema.org/";
    logger.info("Added 'schema' to @context in KA");
  }
  
  // Ensure obi is in the context if we have obi terms
  if (graphResult["obi:OBI_0000299"] && !("obi" in contextValue)) {
    contextValue["obi"] = "http://purl.obolibrary.org/obo/";
    logger.info("Added 'obi' to @context in KA");
  }

  // Create our properly typed GeneratedGraph
  const generatedGraph: GeneratedGraph = {
    "@context": contextValue,
    ...graphResult
  };

  // Set hasPart and id properties
  generatedGraph["dcterms:hasPart"] = await getSummary(client, generatedGraph);
  generatedGraph["@id"] = `https://doi.org/${doi}`; // the doi that we extracted from the paper
  
  // Ensure we have a @type
  if (!generatedGraph["@type"]) {
    generatedGraph["@type"] = "fabio:ResearchPaper";
    logger.info("Added default @type (fabio:ResearchPaper) to KA");
  }
  
  // Validate all arrays in the graph to ensure they're properly formed
  for (const [key, value] of Object.entries(generatedGraph)) {
    if (Array.isArray(value)) {
      // Check each item in the array
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        
        // If it's an object, ensure it has an @id
        if (item && typeof item === 'object' && !('@id' in item)) {
          // Add a generated @id
          (item as any)['@id'] = `urn:uuid:${crypto.randomUUID()}`;
          logger.info(`Added missing @id to item in ${key} array`);
        }
      }
    }
  }
  
  // Debug: Log the final structure
  logger.info(`Generated graph with title: ${generatedGraph["dcterms:title"] || "Untitled"}`);
  logger.info(`Final graph top-level keys: ${Object.keys(generatedGraph).join(', ')}`);
  
  return generatedGraph;
  } catch (error) {
    logger.error("Error in jsonArrToKa:", error);
    throw error;
  }
}


/**
/**
/**
 * 
 * Recursively remove all colons (":") from string values in an object or array,
 * except for certain cases:
 *   1) Skip the entire "@context" object (do not remove colons from any values inside it).
 *   2) Skip any string where the key is "@type".
 *   3) Skip any string that appears to be a URL (starting with "http://", "https://", or "doi:").
 * @param data - The input data which can be an object, array, or primitive.
 * @param parentKey - The key of the parent property (used to check exceptions).
 * @returns A new object, array, or primitive with colons removed from allowed string values.
 */
function removeColonsRecursively<T>(data: T, parentKey?: string): T {
  // 1) If the parent key is "@context", return the data as-is (skip processing entirely)
  if (parentKey === "@context") {
    return data;
  }

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map((item) =>
      removeColonsRecursively(item, parentKey)
    ) as unknown as T;
  }

  // Handle objects
  if (data !== null && typeof data === "object") {
    const newObj: Record<string, unknown> = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        newObj[key] = removeColonsRecursively(
          (data as Record<string, unknown>)[key],
          key
        );
      }
    }
    return newObj as T;
  }

  // Handle strings
  if (typeof data === "string") {
    // 2) If this is the value of "@type", skip removing colons.
    if (parentKey === "@type") {
      return data as unknown as T;
    }

    // 3) If it's a URL/DOI (starts with http://, https://, or doi:), skip removing colons.
    if (/^(https?:\/\/|doi:)/i.test(data)) {
      return data as unknown as T;
    }

    // Otherwise, remove all colons
    return data.replace(/:/g, "") as unknown as T;
  }

  // For numbers, booleans, null, etc., just return as is
  return data;
}
const daoUals = {
  VitaDAO:
    "did:dkg:base:84532/0xd5550173b0f7b8766ab2770e4ba86caf714a5af5/101956",
  AthenaDAO:
    "did:dkg:base:84532/0xd5550173b0f7b8766ab2770e4ba86caf714a5af5/101957",
  PsyDAO:
    "did:dkg:base:84532/0xd5550173b0f7b8766ab2770e4ba86caf714a5af5/101958",
  ValleyDAO:
    "did:dkg:base:84532/0xd5550173b0f7b8766ab2770e4ba86caf714a5af5/101959",
  HairDAO:
    "did:dkg:base:84532/0xd5550173b0f7b8766ab2770e4ba86caf714a5af5/101961",
  CryoDAO:
    "did:dkg:base:84532/0xd5550173b0f7b8766ab2770e4ba86caf714a5af5/101962",
  "Cerebrum DAO":
    "did:dkg:base:84532/0xd5550173b0f7b8766ab2770e4ba86caf714a5af5/101963",
  Curetopia:
    "did:dkg:base:84532/0xd5550173b0f7b8766ab2770e4ba86caf714a5af5/101964",
  "Long Covid Labs":
    "did:dkg:base:84532/0xd5550173b0f7b8766ab2770e4ba86caf714a5af5/101965",
  "Quantum Biology DAO":
    "did:dkg:base:84532/0xd5550173b0f7b8766ab2770e4ba86caf714a5af5/101966",
};

export async function generateKaFromUrls(urls: [string]) {
  for (const url of urls) {
    const { pdfBuffer, doi } = await downloadPaperAndExtractDOI(url);
    if (!pdfBuffer) {
      throw new Error("Failed to download paper");
    }
    if (!doi) {
      throw new Error("Failed to extract DOI");
    }
    const paperArray = await makeUnstructuredApiRequest(
      pdfBuffer,
      "paper.pdf",
      unstructuredApiKey
    );
    // Add type assertion to fix the type error
    const ka = await jsonArrToKa(paperArray as PaperArrayElement[], doi);
    const cleanedKa = removeColonsRecursively(ka);
    return cleanedKa;
  }
  // Add a return statement here for TypeScript to understand all code paths return a value
  return null;
}
export interface Image {
  type: "image";
  source: {
    type: "base64";
    media_type: "image/png";
    data: string;
  };
}
async function extractDOIFromPDF(images: Image[]) {
  const client = getClient();
  const response = await client.messages.create({
    model: "claude-3-5-haiku-latest",
    messages: [
      {
        role: "user",
        content: [
          ...images,
          {
            type: "text",
            text: "Extract the DOI from the paper. Only return the DOI, no other text.",
          },
        ],
      },
    ],
    max_tokens: 50,
  });
  return response.content[0].type === "text"
    ? response.content[0].text
    : undefined;
}

async function categorizeIntoDAOs(images: Image[]) {
  const client = getClient();
  const response = await client.messages.create({
    model: "claude-3-7-sonnet-20250219",
    system: categorizeIntoDAOsPrompt,
    messages: [
      {
        role: "user",
        content: [...images],
      },
    ],
    max_tokens: 50,
  });
  return response.content[0].type === "text"
    ? response.content[0].text
    : undefined;
}


/**
 * Generates a knowledge assembly from a PDF buffer
 */
export async function generateKaFromPdfBuffer(pdfBuffer: Buffer, runtime: IAgentRuntime): Promise<GeneratedGraph> {
  try {
    const apiKey = runtime.getSetting("UNSTRUCTURED_API_KEY");
    if (!apiKey) {
      throw new Error("UNSTRUCTURED_API_KEY not set");
    }

    logger.info("Making API request to Unstructured");
    const unstructuredResponse = await makeUnstructuredApiRequest(
      pdfBuffer,
      "paper.pdf",
      apiKey
    );

    // Type check to ensure unstructuredResponse is an array of PaperArrayElement
    if (!Array.isArray(unstructuredResponse)) {
      throw new Error("Unstructured API response is not an array");
    }

    // Validate array elements have the expected structure
    const validatedResponse: PaperArrayElement[] = unstructuredResponse.map(item => {
      // Simple validation to ensure the item has minimum required fields
      if (!item || typeof item !== 'object') {
        throw new Error("Invalid item in Unstructured API response");
      }
      
      // Ensure metadata and text fields exist
      if (!item.metadata || typeof item.metadata !== 'object') {
        // Create default metadata if missing
        item.metadata = { page_number: 1 };
      }
      
      if (!('text' in item) || typeof item.text !== 'string') {
        // Set empty text if missing
        item.text = '';
      }
      
      return item as PaperArrayElement;
    });

    // Generate a temporary DOI or identifier if one can't be extracted
    const temporaryDoi = `temp-${Date.now()}`;
    
    logger.info("Converting to knowledge assembly");
    const ka = await jsonArrToKa(validatedResponse, temporaryDoi);
    
    return ka;
  } catch (error) {
    logger.error("Error generating KA from PDF:", error);
    throw error;
  }
}

/**
 * Generates a knowledge assembly from a URL to a paper
 */
export async function generateKaFromPdf(paperUrl: string): Promise<GeneratedGraph> {
  const { pdfBuffer, doi } = await downloadPaperAndExtractDOI(paperUrl);
  if (!pdfBuffer) {
    throw new Error("Failed to download PDF");
  }

  const unstructuredApiKey = process.env.UNSTRUCTURED_API_KEY;
  if (!unstructuredApiKey) {
    throw new Error("UNSTRUCTURED_API_KEY not set");
  }
  
  logger.info("Making API request to Unstructured");
  const unstructuredResponse = await makeUnstructuredApiRequest(
    pdfBuffer,
    "paper.pdf",
    unstructuredApiKey
  );

  // Type check and validate the response
  if (!Array.isArray(unstructuredResponse)) {
    throw new Error("Unstructured API response is not an array");
  }
  
  // Validate array elements
  const validatedResponse: PaperArrayElement[] = unstructuredResponse.map(item => {
    if (!item || typeof item !== 'object') {
      throw new Error("Invalid item in Unstructured API response");
    }
    
    if (!item.metadata || typeof item.metadata !== 'object') {
      item.metadata = { page_number: 1 };
    }
    
    if (!('text' in item) || typeof item.text !== 'string') {
      item.text = '';
    }
    
    return item as PaperArrayElement;
  });

  logger.info("Converting to knowledge assembly");
  const ka = await jsonArrToKa(validatedResponse, doi || `temp-${Date.now()}`);
  
  return ka;
}


/**
 * Processes text content into a knowledge assembly
 */
export async function processDocumentContent(content: string, dkgClient: DKGClient): Promise<GeneratedGraph> {
  const client = getClient();
  
  // Create a synthetic ID based on the content hash
  const contentHash = crypto.createHash('md5').update(content).digest('hex');
  const syntheticDoi = `synthetic-${contentHash.substring(0, 8)}`;
  
  logger.info(`Processing document content with hash: ${contentHash}`);
  logger.info(`Content length: ${content.length} characters`);
  logger.info(`Synthetic DOI: ${syntheticDoi}`);
  
  try {
    // For text content, we'll use Claude to help structure it into sections
    const structuringPrompt = `
    I have the content of a scientific paper that needs to be structured. 
    Please analyze this content and divide it into the following sections (if present):
    - Title
    - Authors
    - Abstract
    - Introduction
    - Methods
    - Results
    - Discussion
    - Conclusion
    - References
    
    For each section, output the content in JSON format like this:
    {
      "title": "The paper title",
      "authors": ["Author 1", "Author 2"],
      "abstract": "The abstract text...",
      "introduction": "The introduction text...",
      "methods": "The methods text...",
      "results": "The results text...",
      "discussion": "The discussion text...",
      "conclusion": "The conclusion text...",
      "references": ["Reference 1", "Reference 2"]
    }
    
    If a section is not present, leave it as an empty string or empty array as appropriate.
    Here's the paper content: 
    
    ${content.substring(0, 10000)}  // Limit to first 10k chars to avoid token limits
    `;
    
    const structuredResponse = await generateResponse(client, structuringPrompt);
    let structuredContent;
    
    try {
      // Try to parse the JSON response
      structuredContent = JSON.parse(structuredResponse);
    } catch (error) {
      logger.error("Failed to parse structured content as JSON, using fallback method");
      
      // Create a simpler structure as fallback
      structuredContent = {
        title: "Untitled Paper",
        authors: [],
        abstract: content.substring(0, 500),  // Use first 500 chars as abstract
        introduction: "",
        methods: "",
        results: "",
        discussion: "",
        conclusion: "",
        references: []
      };
    }
    
    // Now create a synthetic JSON array for jsonArrToKa
    const syntheticJsonArr: PaperArrayElement[] = [
      {
        metadata: {
          page_number: 1
        },
        text: structuredContent.title || "Untitled Paper",
        type: "NarrativeText"
      },
      {
        metadata: {
          page_number: 1
        },
        text: Array.isArray(structuredContent.authors) ? structuredContent.authors.join(", ") : "",
        type: "NarrativeText"
      },
      {
        metadata: {
          page_number: 1
        },
        text: structuredContent.abstract || "",
        type: "NarrativeText"
      }
    ];
    
    // Add each section as a separate element
    ["introduction", "methods", "results", "discussion", "conclusion"].forEach((section, index) => {
      if (structuredContent[section]) {
        syntheticJsonArr.push({
          metadata: {
            page_number: index + 2  // Start from page 2
          },
          text: structuredContent[section],
          type: "NarrativeText"
        });
      }
    });
    
    // Add references if present
    if (Array.isArray(structuredContent.references) && structuredContent.references.length > 0) {
      syntheticJsonArr.push({
        metadata: {
          page_number: 10  // Arbitrary high page number for references
        },
        text: structuredContent.references.join("\n"),
        type: "NarrativeText"
      });
    }
    
    // Process the synthetic JSON array into a knowledge assembly
    logger.info(`Created synthetic JSON array with ${syntheticJsonArr.length} elements`);
    logger.info(`First element title: ${syntheticJsonArr[0].text}`);
    
    try {
      const result = await jsonArrToKa(syntheticJsonArr, syntheticDoi);
      logger.info(`Successfully created knowledge assembly with title: ${result["dcterms:title"] || "Untitled"}`);
      return result;
    } catch (error) {
      logger.error(`Error in jsonArrToKa during processDocumentContent: ${error.message}`);
      throw error;
    }
    
  } catch (error) {
    logger.error("Error processing document content:", error);
    // Return a fallback graph to avoid returning null
    return createFallbackKA("Untitled Paper", content);
  }
}

// Helper functions to extract title and abstract
function extractTitleFromText(text: string): string {
  // Look for title patterns in the first few lines
  const lines = text.split('\n').slice(0, 10);
  
  // Try to find a line that looks like a title (usually capitalized, no ending punctuation)
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 10 && trimmed.length < 200 && 
        !trimmed.endsWith('.') && /^[A-Z]/.test(trimmed)) {
      return trimmed;
    }
  }
  
  // Fallback: use the first non-empty line
  for (const line of lines) {
    if (line.trim().length > 0) {
      return line.trim();
    }
  }
  
  return "Untitled Document";
}

function extractAbstractFromText(text: string): string {
  // Look for "Abstract" section
  const abstractMatch = text.match(/Abstract[\s\n:]+([^]*?)(?:\n\s*\n|\n\s*[A-Z][a-z]+\s*\n)/i);
  if (abstractMatch && abstractMatch[1]) {
    return abstractMatch[1].trim();
  }
  
  // Fallback: use the first few paragraphs
  const paragraphs = text.split(/\n\s*\n/).slice(0, 3);
  if (paragraphs.length > 1) {
    return paragraphs[1].trim();
  }
  
  return text.substring(0, 500) + "...";
}

/**
 * Creates a fallback KA when all else fails
 */
export async function createFallbackKA(title: string, content: string): Promise<GeneratedGraph> {
  logger.info(`Creating fallback KA with title: ${title}`);
  const contentHash = crypto.createHash('md5').update(content).digest('hex');
  const syntheticDoi = `fallback-${contentHash.substring(0, 8)}`;
  logger.info(`Fallback synthetic DOI: ${syntheticDoi}`);
  
  // Create a basic but valid graph
  const fallbackGraph: GeneratedGraph = {
    "@context": {
      "dcterms": "http://purl.org/dc/terms/",
      "fabio": "http://purl.org/spar/fabio/",
      "foaf": "http://xmlns.com/foaf/0.1/",
      "schema": "http://schema.org/"
    },
    "@id": `https://doi.org/${syntheticDoi}`,
    "@type": "fabio:ResearchPaper",
    "dcterms:title": title || "Untitled Paper",
    "dcterms:creator": [{
      "@type": "foaf:Person",
      "foaf:name": "Unknown Author"
    }],
    "dcterms:abstract": content.substring(0, 500),
    "dcterms:hasPart": content.substring(0, 2000),
    "schema:datePublished": new Date().toISOString().split('T')[0]
  };
  
  logger.info(`Fallback KA created successfully with title: ${fallbackGraph["dcterms:title"]}`);
  return fallbackGraph;
}
