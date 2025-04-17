import axios from "axios";
import { SparqlError } from "../errors";

// Read ENV and fallback to "dev"
const ENV = process.env.ENV || "dev";

// Choose Oxigraph base URL
const rawOxigraphBase =
  ENV === "prod"
    ? process.env.PROD_OXIGRAPH_HOST
    : process.env.LOCAL_OXIGRAPH_HOST || "http://localhost:7878";

// Normalize (remove trailing slash if present)
const OXIGRAPH_BASE = rawOxigraphBase?.replace(/\/$/, "");

// Final query endpoint
const OXIGRAPH_QUERY_ENDPOINT = `${OXIGRAPH_BASE}/query`;

export async function sparqlRequest(query: string) {
  try {
    const { data } = await axios.post(OXIGRAPH_QUERY_ENDPOINT, query, {
      headers: {
        "Content-Type": "application/sparql-query",
        Accept: "application/sparql-results+json",
      },
    });
    return data;
  } catch (error) {
    // Check if it's an axios error using type assertion
    if (error && typeof error === 'object' && 'isAxiosError' in error) {
      throw new SparqlError(
        `SPARQL request failed: ${(error as any).message}`,
        error as any
      );
    }
    throw error;
  }
}
