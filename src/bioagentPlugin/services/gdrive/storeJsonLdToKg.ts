import { Store, Quad } from "n3";
import { JsonLdParser } from "jsonld-streaming-parser";
import axios from "axios";
import crypto from "crypto";
import "dotenv/config";
import { logger } from "@elizaos/core";

const ENV = process.env.ENV;
const OXIGRAPH_HOST =
  ENV === "prod"
    ? process.env.PROD_OXIGRAPH_HOST
    : process.env.LOCAL_OXIGRAPH_HOST || "http://localhost:7878";

/**
 * Recursively adds an @id field (with a random UUID) to all objects
 * in the parsed JSON-LD data structure that are missing the @id property.
 * This function skips the @context node to avoid "keyword redefinition" errors.
 */
function addMissingIdsToJsonLd(jsonLdString: string): string {
  const data = JSON.parse(jsonLdString);

  function ensureId(obj: any): void {
    if (Array.isArray(obj)) {
      for (const item of obj) {
        ensureId(item);
      }
    } else if (obj && typeof obj === "object") {
      // If this object has a @context, don't recurse into it
      if (obj["@context"]) {
        const savedContext = obj["@context"];
        delete obj["@context"]; // Temporarily remove @context
        if (!obj["@id"]) {
          obj["@id"] = crypto.randomUUID();
        }
        // Recurse on other keys
        for (const key of Object.keys(obj)) {
          ensureId(obj[key]);
        }
        // Restore the @context
        obj["@context"] = savedContext;
      } else {
        if (!obj["@id"]) {
          obj["@id"] = crypto.randomUUID();
        }
        // Recurse into all child properties
        for (const key of Object.keys(obj)) {
          ensureId(obj[key]);
        }
      }
    }
  }

  ensureId(data);
  return JSON.stringify(data, null, 2);
}

/**
 * Accepts a JSON-LD object, ensures valid @id fields, parses it to quads,
 * and stores the resulting data in Oxigraph. Then also stores the JSON-LD
 * on the DKG. Returns { success: boolean, ual?: string } from the DKG.
 */
export async function storeJsonLd(
  jsonLd: object,
  DkgClient: any // Pass your DKG client instance here
): Promise<{ success: boolean; ual?: string }> {
  logger.info("Starting storeJsonLd function");
  const store = new Store();
  const parser = new JsonLdParser();

  // 1) Add missing @id fields
  const fixedJsonLdString = addMissingIdsToJsonLd(JSON.stringify(jsonLd));
  logger.info("Added missing IDs to JSON-LD");

  // 2) Parse the JSON-LD and store in Oxigraph
  const oxigraphResult = await new Promise<boolean>((resolve, reject) => {
    parser.on("data", (quad: Quad) => {
      try {
        store.addQuad(quad);
      } catch (error) {
        logger.warn(`Warning: Could not add quad: ${error.message}`);
      }
    });

    parser.on("error", (error: Error) => {
      logger.error("Parsing error:", error);
      reject(error);
    });

    parser.on("end", async () => {
      logger.info(`Parsed ${store.size} quads`);
      if (store.size === 0) {
        logger.warn("No valid quads generated from JSON-LD");
        resolve(false);
        return;
      }

      // Convert store to N-Triples
      const ntriples: string[] = [];
      store.forEach((quad) => {
        try {
          if (quad.subject && quad.predicate && quad.object) {
            let objectValue = "";
            if (quad.object.termType === "Literal") {
              // Escape special characters
              const escaped = quad.object.value
                .replace(/\\/g, "\\\\")
                .replace(/"/g, '\\"')
                .replace(/\n/g, "\\n")
                .replace(/\r/g, "\\r");
              objectValue = `"${escaped}"`;

              // datatype or language
              if (
                quad.object.datatype &&
                quad.object.datatype.value !==
                  "http://www.w3.org/2001/XMLSchema#string"
              ) {
                objectValue += `^^<${quad.object.datatype.value}>`;
              } else if (quad.object.language) {
                objectValue += `@${quad.object.language}`;
              }
            } else {
              // URIs or blank nodes
              objectValue =
                quad.object.termType === "NamedNode"
                  ? `<${quad.object.value}>`
                  : `_:${quad.object.value}`;
            }

            const subjectValue =
              quad.subject.termType === "NamedNode"
                ? `<${quad.subject.value}>`
                : `_:${quad.subject.value}`;

            ntriples.push(
              `${subjectValue} <${quad.predicate.value}> ${objectValue} .`
            );
          }
        } catch (e) {
          logger.warn(`Warning: Could not format quad: ${e.message}`);
        }
      });

      if (ntriples.length === 0) {
        logger.warn("No valid triples generated from quads");
        resolve(false);
        return;
      }

      const ntriplesString = ntriples.join("\n");
      const oxigraphUrl = process.env.LOCAL_OXIGRAPH_HOST || "http://oxigraph:7878/sparql";

      try {
        const response = await axios.post(
          `${oxigraphUrl}/store`,
          ntriplesString,
          {
            headers: {
              "Content-Type": "application/n-quads",
            },
          }
        );

        if (
          response.status === 200 ||
          response.status === 201 ||
          response.status === 204
        ) {
          logger.info(
            `Successfully stored ${ntriples.length} triples in Oxigraph`
          );
          resolve(true);
        } else {
          logger.error(`Unexpected response status: ${response.status}`);
          resolve(false);
        }
      } catch (error) {
        logger.error("Error storing in Oxigraph:", error);
        resolve(false);
      }
    });

    // Begin parsing
    try {
      parser.write(fixedJsonLdString);
      parser.end();
    } catch (error) {
      logger.error("Error writing to parser:", error);
      reject(error);
    }
  });

  // 3) Store the JSON-LD in the DKG (with epochsNum, etc.)
  let dkgUal: string | undefined = undefined;
  if (oxigraphResult) {
    try {
      // Convert the final JSON-LD string (with inserted @ids) back to an object
      let jsonToStore = JSON.parse(fixedJsonLdString);
      
      // Debug: Log the JSON-LD structure before sending to DKG
      logger.info("JSON-LD structure before DKG storage:");
      logger.info(`@context present: ${!!jsonToStore["@context"]}`);
      logger.info(`@id present: ${!!jsonToStore["@id"]}`);
      logger.info(`@type present: ${!!jsonToStore["@type"]}`);
      logger.info(`Top-level keys: ${Object.keys(jsonToStore).join(", ")}`);
      
      // Debug: Log a sample of the JSON-LD content (first 500 chars)
      const jsonString = JSON.stringify(jsonToStore);
      logger.info(`JSON-LD content sample: ${jsonString.substring(0, 500)}...`);
      
      try {
        // Instead of trying to dynamically require jsonld, which may not work in all environments,
        // we'll just check for common issues directly
        logger.info("Checking for JSON-LD issues...");
        checkJsonLdIssues(jsonToStore);
        
        // Apply fixes regardless of whether we can test expansion
        logger.info("Applying JSON-LD fixes...");
        fixJsonLdIssues(jsonToStore);
        
        // Create a completely sanitized version of the JSON-LD
        logger.info("Creating sanitized JSON-LD document...");
        jsonToStore = createSanitizedJsonLd(jsonToStore);
        logger.info("Using sanitized JSON-LD for DKG storage");
      } catch (checkErr) {
        logger.error("Error during JSON-LD validation check:", checkErr);
      }

      // 🛡️ SAFETY CHECK: Skip upload if content is likely fallback or lacks real data
      const title = jsonToStore["dcterms:title"] || jsonToStore["schema:name"] || "";
      const abstract = jsonToStore["dcterms:abstract"] || jsonToStore["schema:abstract"] || "";

      const isLikelyFallback = (
        title.toLowerCase().includes("untitled") ||
        abstract.trim().length < 50 ||
        Object.keys(jsonToStore).length <= 5
      );

      if (isLikelyFallback) {
        logger.warn("🚫 Skipping DKG upload: Content appears to be fallback or lacks substance.");
        logger.debug(`Fallback check triggered for title: "${title}", abstract length: ${abstract.length}`);
        return { success: false };
      }


      // Try to create the asset with safe mode disabled first
      try {
        logger.info("Attempting to create DKG asset with safe mode disabled");
        const dkgResponse = await DkgClient.asset.create(
          {
            public: jsonToStore,
          },
          { 
            epochsNum: 12,
            // Explicitly disable safe mode for the jsonld library
            options: {
              jsonldOptions: {
                safe: false
              }
            }
          }
        );
        
        // Log the full DKG response for debugging
        logger.info(`DKG response received: ${JSON.stringify(dkgResponse, null, 2)}`);
        
        if (dkgResponse && (dkgResponse.ual || dkgResponse.UAL)) {
          // Handle case sensitivity - DKG might return "UAL" (uppercase) instead of "ual" (lowercase)
          dkgUal = dkgResponse.ual || dkgResponse.UAL;
          logger.info(`Stored in DKG with UAL: ${dkgUal}`);
        } else if (dkgResponse) {
          logger.warn("DKG responded but did not provide a UAL");
          logger.warn(`DKG response keys: ${Object.keys(dkgResponse).join(', ')}`);
          
          // Check if there's an alternative identifier in the response
          if (dkgResponse.id) {
            logger.info(`Found alternative ID in response: ${dkgResponse.id}`);
            dkgUal = dkgResponse.id;
          } else if (dkgResponse.assetId) {
            logger.info(`Found assetId in response: ${dkgResponse.assetId}`);
            dkgUal = dkgResponse.assetId;
          } else if (dkgResponse.asset && dkgResponse.asset.id) {
            logger.info(`Found asset.id in response: ${dkgResponse.asset.id}`);
            dkgUal = dkgResponse.asset.id;
          }
        } else {
          logger.warn("DKG returned empty or null response");
        }
      } catch (safeErr) {
        logger.error("Failed to create asset with safe mode disabled:", safeErr);
        
        // Fall back to standard creation if specific options aren't supported
        logger.info("Falling back to standard DKG asset creation");
        const dkgResponse = await DkgClient.asset.create(
          {
            public: jsonToStore,
          },
          { epochsNum: 12 }
        );

        // Log the full DKG response for debugging
        logger.info(`DKG standard response received: ${JSON.stringify(dkgResponse, null, 2)}`);
        
        if (dkgResponse && (dkgResponse.ual || dkgResponse.UAL)) {
          // Handle case sensitivity - DKG might return "UAL" (uppercase) instead of "ual" (lowercase)
          dkgUal = dkgResponse.ual || dkgResponse.UAL;
          logger.info(`Stored in DKG with UAL: ${dkgUal}`);
        } else if (dkgResponse) {
          logger.warn("DKG standard creation responded but did not provide a UAL");
          logger.warn(`DKG response keys: ${Object.keys(dkgResponse).join(', ')}`);
          
          // Check if there's an alternative identifier in the response
          if (dkgResponse.id) {
            logger.info(`Found alternative ID in response: ${dkgResponse.id}`);
            dkgUal = dkgResponse.id;
          } else if (dkgResponse.assetId) {
            logger.info(`Found assetId in response: ${dkgResponse.assetId}`);
            dkgUal = dkgResponse.assetId;
          } else if (dkgResponse.asset && dkgResponse.asset.id) {
            logger.info(`Found asset.id in response: ${dkgResponse.asset.id}`);
            dkgUal = dkgResponse.asset.id;
          }
        } else {
          logger.warn("DKG returned empty or null response");
        }
      }
    } catch (err) {
      logger.error("Error storing in DKG:", err);
      
      // Enhanced error logging
      if (err instanceof Error) {
        logger.error(`Error name: ${err.name}`);
        logger.error(`Error message: ${err.message}`);
        
        // Try to extract more details from the error
        if (err.message.includes("ValidationError")) {
          logger.error("This appears to be a JSON-LD validation error. Check for:");
          logger.error("- Invalid @context values");
          logger.error("- Malformed IRIs or blank node identifiers");
          logger.error("- Invalid datatype values");
          logger.error("- Structural issues in the JSON-LD document");
        }
      }
    }
  } else {
    logger.warn("Oxigraph storage failed or no quads found; skipping DKG store");
  }

  // 4) Return the overall success + UAL
  const successFlag = oxigraphResult && !!dkgUal;
  return {
    success: successFlag,
    ual: dkgUal,
  };
}

/**
 * Helper function to check for common JSON-LD issues
 */
function checkJsonLdIssues(jsonLd: any) {
  // Check for context issues
  if (jsonLd["@context"]) {
    logger.info("Checking @context structure...");
    const context = jsonLd["@context"];
    
    if (typeof context === 'object' && !Array.isArray(context)) {
      // Check for invalid context entries
      for (const [prefix, uri] of Object.entries(context)) {
        if (typeof uri !== 'string') {
          logger.error(`Invalid @context value for "${prefix}": ${JSON.stringify(uri)}`);
        } else if (!uri.includes(':') && !uri.startsWith('http')) {
          logger.error(`Suspicious @context URI for "${prefix}": ${uri}`);
        }
      }
    } else if (Array.isArray(context)) {
      logger.info("@context is an array, which can be complex to validate");
    }
  } else {
    logger.error("Missing @context in JSON-LD document");
  }
  
  // Check for @id issues
  if (jsonLd["@id"] && typeof jsonLd["@id"] !== 'string') {
    logger.error(`Invalid @id value: ${JSON.stringify(jsonLd["@id"])}`);
  }
  
  // Check for nested objects with potential issues
  function checkNestedObjects(obj: any, path: string) {
    if (!obj || typeof obj !== 'object') return;
    
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        checkNestedObjects(item, `${path}[${index}]`);
      });
    } else {
      for (const [key, value] of Object.entries(obj)) {
        // Check for invalid values in properties
        if (value === null) {
          logger.error(`Null value found at ${path}.${key}`);
        }
        
        // Check for objects with @value but missing @type or @language
        if (key === '@value' && typeof obj['@type'] !== 'string' && typeof obj['@language'] !== 'string') {
          logger.error(`@value without @type or @language at ${path}`);
        }
        
        // Recursively check nested objects
        if (value && typeof value === 'object') {
          checkNestedObjects(value, `${path}.${key}`);
        }
      }
    }
  }
  
  checkNestedObjects(jsonLd, 'root');
}

/**
 * Creates a completely sanitized JSON-LD document with minimal structure
 * to avoid validation errors in the DKG
 */
function createSanitizedJsonLd(originalJson: any): any {
  logger.info("Creating sanitized JSON-LD document");
  
  // Create a new minimal JSON-LD document with only essential properties
  const sanitized: any = {
    "@context": {
      "dcterms": "http://purl.org/dc/terms/",
      "fabio": "http://purl.org/spar/fabio/",
      "schema": "http://schema.org/"
    },
    "@id": originalJson["@id"] || `urn:uuid:${crypto.randomUUID()}`,
    "@type": originalJson["@type"] || "fabio:ResearchPaper"
  };
  
  // Copy over basic properties if they exist and are valid
  if (originalJson["dcterms:title"] && typeof originalJson["dcterms:title"] === "string") {
    sanitized["dcterms:title"] = originalJson["dcterms:title"];
  } else {
    sanitized["dcterms:title"] = "Untitled Document";
  }
  
  if (originalJson["dcterms:abstract"] && typeof originalJson["dcterms:abstract"] === "string") {
    sanitized["dcterms:abstract"] = originalJson["dcterms:abstract"];
  }
  
  // Add a simple creator if it exists
  if (originalJson["dcterms:creator"] && Array.isArray(originalJson["dcterms:creator"])) {
    sanitized["dcterms:creator"] = [];
    
    // Take only the first few creators to keep it simple
    const maxCreators = Math.min(originalJson["dcterms:creator"].length, 3);
    
    for (let i = 0; i < maxCreators; i++) {
      const creator = originalJson["dcterms:creator"][i];
      if (creator && typeof creator === "object") {
        sanitized["dcterms:creator"].push({
          "@id": creator["@id"] || `urn:uuid:${crypto.randomUUID()}`,
          "@type": "schema:Person",
          "schema:name": creator["foaf:name"] || creator["schema:name"] || "Unknown Author"
        });
      }
    }
  }
  
  // Add a simple date if available
  if (originalJson["dcterms:date"] && typeof originalJson["dcterms:date"] === "string") {
    sanitized["dcterms:date"] = originalJson["dcterms:date"];
  } else {
    sanitized["dcterms:date"] = new Date().toISOString().split('T')[0];
  }
  
  logger.info(`Sanitized JSON-LD created with ${Object.keys(sanitized).length} top-level properties`);
  return sanitized;
}

/**
 * Helper function to fix common JSON-LD issues
 */
function fixJsonLdIssues(jsonLd: any) {
  // Ensure we have a valid @context
  if (!jsonLd["@context"]) {
    logger.info("Adding missing @context");
    jsonLd["@context"] = {
      "dcterms": "http://purl.org/dc/terms/",
      "fabio": "http://purl.org/spar/fabio/",
      "cito": "http://purl.org/spar/cito/",
      "foaf": "http://xmlns.com/foaf/0.1/",
      "schema": "http://schema.org/",
      "obi": "http://purl.obolibrary.org/obo/"
    };
  } else if (typeof jsonLd["@context"] === 'object' && !Array.isArray(jsonLd["@context"])) {
    // Fix any invalid context entries
    const context = jsonLd["@context"];
    for (const [prefix, uri] of Object.entries(context)) {
      if (typeof uri !== 'string') {
        logger.info(`Fixing invalid @context value for "${prefix}"`);
        delete context[prefix];
      } else if (!uri.includes(':') && !uri.startsWith('http')) {
        logger.info(`Fixing suspicious @context URI for "${prefix}"`);
        if (prefix === 'obi') {
          context[prefix] = "http://purl.obolibrary.org/obo/";
        } else if (prefix === 'dcterms') {
          context[prefix] = "http://purl.org/dc/terms/";
        } else if (prefix === 'fabio') {
          context[prefix] = "http://purl.org/spar/fabio/";
        } else if (prefix === 'cito') {
          context[prefix] = "http://purl.org/spar/cito/";
        } else if (prefix === 'foaf') {
          context[prefix] = "http://xmlns.com/foaf/0.1/";
        } else if (prefix === 'schema') {
          context[prefix] = "http://schema.org/";
        }
      }
    }
  }
  
  // Ensure we have a valid @id
  if (!jsonLd["@id"] || typeof jsonLd["@id"] !== 'string') {
    logger.info("Adding or fixing @id");
    jsonLd["@id"] = `urn:uuid:${crypto.randomUUID()}`;
  }
  
  // Ensure we have a valid @type
  if (!jsonLd["@type"]) {
    logger.info("Adding missing @type");
    jsonLd["@type"] = "fabio:ResearchPaper";
  }
  
  // Fix nested objects with potential issues
  function fixNestedObjects(obj: any, path: string) {
    if (!obj || typeof obj !== 'object') return;
    
    // Skip processing @context object completely
    if (path === 'root.@context') {
      return;
    }
    
    if (Array.isArray(obj)) {
      // Remove null values from arrays
      for (let i = obj.length - 1; i >= 0; i--) {
        if (obj[i] === null) {
          logger.info(`Removing null value at ${path}[${i}]`);
          obj.splice(i, 1);
        } else {
          fixNestedObjects(obj[i], `${path}[${i}]`);
        }
      }
    } else {
      // Fix object properties
      for (const [key, value] of Object.entries(obj)) {
        // Skip @context objects at any level
        if (key === '@context') {
          continue;
        }
        
        // Remove null values
        if (value === null) {
          logger.info(`Removing null value at ${path}.${key}`);
          delete obj[key];
          continue;
        }
        
        // Fix @value objects without @type or @language
        if (key === '@value' && typeof obj['@type'] !== 'string' && typeof obj['@language'] !== 'string') {
          logger.info(`Adding missing @type to @value at ${path}`);
          obj['@type'] = 'http://www.w3.org/2001/XMLSchema#string';
        }
        
        // Ensure objects have @id, but don't add @id to @context or other reserved objects
        if (value && typeof value === 'object' && !Array.isArray(value) && 
            !('@id' in value) && !('@value' in value) && 
            key !== '@context' && !key.startsWith('@')) {
          logger.info(`Adding missing @id to object at ${path}.${key}`);
          value['@id'] = `urn:uuid:${crypto.randomUUID()}`;
        }
        
        // Recursively fix nested objects
        if (value && typeof value === 'object') {
          // Skip @context objects
          if (key !== '@context') {
            fixNestedObjects(value, `${path}.${key}`);
          }
        }
      }
    }
  }
  
  fixNestedObjects(jsonLd, 'root');
  
  logger.info("JSON-LD fixes applied");
}
