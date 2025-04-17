import { Store } from "n3";
import { JsonLdParser } from "jsonld-streaming-parser";
import axios from "axios";
import fs from "fs";
import path from "path";

async function processJsonLdFile(filePath: string) {
  const store = new Store();
  const parser = new JsonLdParser();
  let jsonLdString: string;
  
  try {
    jsonLdString = fs.readFileSync(filePath, "utf-8");
    // Check if the file is valid JSON
    JSON.parse(jsonLdString);
  } catch (error) {
    console.error(`Invalid JSON in ${filePath}:`, error.message);
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    try {
      parser.on("data", (quad) => {
        try {
          if (quad && quad.subject && quad.predicate && quad.object) {
            store.addQuad(quad);
          }
        } catch (e) {
          console.warn(`Warning: Could not add quad from ${filePath}:`, e.message);
        }
      });

      parser.on("error", (error) => {
        console.error(`Parsing error in ${filePath}:`, error);
        // Continue despite errors
        resolve(false);
      });

      parser.on("end", async () => {
        console.log(`\nProcessing ${path.basename(filePath)}:`);
        console.log(`Parsed ${store.size} quads`);

        if (store.size === 0) {
          console.log(`No valid quads found in ${path.basename(filePath)}, skipping.`);
          return resolve(true);
        }

        // Convert store to N-Triples format
        const ntriples: string[] = [];
        store.forEach(quad => {
          try {
            if (quad.subject && quad.predicate && quad.object) {
              let objectValue = "";
              
              if (quad.object.termType === "Literal") {
                // Handle string literals - escape quotes properly
                const escapedValue = quad.object.value
                  .replace(/\\/g, "\\\\")
                  .replace(/"/g, '\\"')
                  .replace(/\n/g, "\\n")
                  .replace(/\r/g, "\\r");
                
                objectValue = `"${escapedValue}"`;
                
                // Add datatype or language tag if present
                if (quad.object.datatype && quad.object.datatype.value !== "http://www.w3.org/2001/XMLSchema#string") {
                  objectValue += `^^<${quad.object.datatype.value}>`;
                } else if (quad.object.language) {
                  objectValue += `@${quad.object.language}`;
                }
              } else {
                // Handle URIs and blank nodes
                objectValue = `<${quad.object.value}>`;
              }
              
              ntriples.push(`<${quad.subject.value}> <${quad.predicate.value}> ${objectValue}.`);
            }
          } catch (e) {
            console.warn(`Warning: Could not format quad from ${filePath}:`, e.message);
          }
        });

        const ntriplesString = ntriples.join("\n");
        
        if (ntriples.length === 0) {
          console.log(`No valid triples generated from ${path.basename(filePath)}, skipping.`);
          return resolve(true);
        }

        try {
          // Store in Oxigraph
          const OXIGRAPH_HOST = process.env.OXIGRAPH_HOST || "http://localhost:7878";
          const OXIGRAPH_STORE_ENDPOINT = `${OXIGRAPH_HOST}/store`;

          const response = await axios.post(
            OXIGRAPH_STORE_ENDPOINT,
            ntriplesString,
            {
              headers: {
                "Content-Type": "application/n-quads",
              },
            }
          );

          if (response.status === 204) {
            console.log(
              `Successfully stored ${ntriples.length} triples from ${path.basename(filePath)} in Oxigraph`
            );
            resolve(true);
          }
        } catch (error) {
          console.error(
            `Error storing ${path.basename(filePath)} in Oxigraph:`,
            error.message
          );
          
          // Log a sample of the triples that caused issues
          console.error("Sample of problematic triples:");
          console.error(ntriplesString.slice(0, 500) + "...");
          
          reject(error);
        }
      });

      parser.write(jsonLdString);
      parser.end();
    } catch (error) {
      console.error(`Error processing ${filePath}:`, error);
      reject(error);
    }
  });
}

async function main() {
  const outputDir = path.join(process.cwd(), "sampleJsonLdsNew");
  const files = fs
    .readdirSync(outputDir)
    .filter((file) => file.endsWith(".json"));

  console.log(`Found ${files.length} JSON-LD files to process`);

  // Track stats
  let successCount = 0;
  let errorCount = 0;
  let skippedProblematicFiles = ["ka-53n80o9l4gt.json", "ka-9q9j6ynl7k7.json"];
  
  for (const file of files) {
    // Skip known problematic files
    if (skippedProblematicFiles.includes(file)) {
      console.log(`Skipping known problematic file: ${file}`);
      continue;
    }
    
    const filePath = path.join(outputDir, file);
    try {
      const result = await processJsonLdFile(filePath);
      if (result) {
        successCount++;
      } else {
        errorCount++;
      }
    } catch (error) {
      console.error(`Failed to process ${file}:`, error.message);
      errorCount++;
    }
  }

  console.log("\nProcessing complete!");
  console.log(`Successfully processed: ${successCount} files`);
  console.log(`Failed to process: ${errorCount} files`);
}

main().catch(console.error);