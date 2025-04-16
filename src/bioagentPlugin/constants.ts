import { z } from "zod";
// TODO: add isConnectedTo field or similar which you will use to connect w other KAs
export const dkgMemoryTemplate = {
    "@context": "http://schema.org",
    "@type": "SocialMediaPosting",
    headline: "<describe memory in a short way, as a title here>",
    articleBody:
        "Check out this amazing project on decentralized cloud networks! @DecentralCloud #Blockchain #Web3",
    author: {
        "@type": "Person",
        "@id": "uuid:john:doe",
        name: "John Doe",
        identifier: "@JohnDoe",
        url: "https://twitter.com/JohnDoe",
    },
    dateCreated: "yyyy-mm-ddTHH:mm:ssZ",
    interactionStatistic: [
        {
            "@type": "InteractionCounter",
            interactionType: {
                "@type": "LikeAction",
            },
            userInteractionCount: 150,
        },
        {
            "@type": "InteractionCounter",
            interactionType: {
                "@type": "ShareAction",
            },
            userInteractionCount: 45,
        },
    ],
    mentions: [
        {
            "@type": "Person",
            name: "Twitter account mentioned name goes here",
            identifier: "@TwitterAccount",
            url: "https://twitter.com/TwitterAccount",
        },
    ],
    keywords: [
        {
            "@type": "Text",
            "@id": "uuid:keyword1",
            name: "keyword1",
        },
        {
            "@type": "Text",
            "@id": "uuid:keyword2",
            name: "keyword2",
        },
    ],
    about: [
        {
            "@type": "Thing",
            "@id": "uuid:thing1",
            name: "Blockchain",
            url: "https://en.wikipedia.org/wiki/Blockchain",
        },
        {
            "@type": "Thing",
            "@id": "uuid:thing2",
            name: "Web3",
            url: "https://en.wikipedia.org/wiki/Web3",
        },
        {
            "@type": "Thing",
            "@id": "uuid:thing3",
            name: "Decentralized Cloud",
            url: "https://example.com/DecentralizedCloud",
        },
    ],
    url: "https://twitter.com/JohnDoe/status/1234567890",
};

export const combinedSparqlExample = `
SELECT DISTINCT ?headline ?articleBody
    WHERE {
      ?s a <http://schema.org/SocialMediaPosting> .
      ?s <http://schema.org/headline> ?headline .
      ?s <http://schema.org/articleBody> ?articleBody .

      OPTIONAL {
        ?s <http://schema.org/keywords> ?keyword .
        ?keyword <http://schema.org/name> ?keywordName .
      }

      OPTIONAL {
        ?s <http://schema.org/about> ?about .
        ?about <http://schema.org/name> ?aboutName .
      }

      FILTER(
        CONTAINS(LCASE(?headline), "example_keyword") ||
        (BOUND(?keywordName) && CONTAINS(LCASE(?keywordName), "example_keyword")) ||
        (BOUND(?aboutName) && CONTAINS(LCASE(?aboutName), "example_keyword"))
      )
    }
    LIMIT 10`;

// DKG Explorer links for different environments
export const DKG_EXPLORER_LINKS = {
  devnet: "https://dkg-explorer.origintrail.io",
  testnet: "https://dkg-explorer-testnet.origintrail.io",
  mainnet: "https://dkg-explorer-mainnet.origintrail.io"
};

// Scientific paper template
export const scientificPaperTemplate = {
  "@context": {
    "dcterms": "http://purl.org/dc/terms/",
    "bibo": "http://purl.org/ontology/bibo/",
    "fabio": "http://purl.org/spar/fabio/",
    "cito": "http://purl.org/spar/cito/",
    "foaf": "http://xmlns.com/foaf/0.1/",
    "schema": "http://schema.org/",
    "go": "http://purl.obolibrary.org/obo/GO_",
    "doid": "http://purl.org/obo/DOID_",
    "chebi": "http://purl.org/obo/CHEBI_",
    "atc": "http://purl.org/obo/ATC_"
  },
  "@type": "fabio:ResearchPaper",
  "dcterms:title": "<title of the paper>",
  "dcterms:creator": [
    {
      "@type": "foaf:Person",
      "foaf:name": "<author name>"
    }
  ],
  "dcterms:abstract": "<abstract of the paper>",
  "schema:datePublished": "YYYY-MM-DD",
  "fabio:hasPart": [
    {
      "@type": "doco:Section",
      "dcterms:title": "Introduction",
      "rdf:value": "<content of introduction>"
    },
    {
      "@type": "doco:Section",
      "dcterms:title": "Methods",
      "rdf:value": "<content of methods>"
    },
    {
      "@type": "doco:Section",
      "dcterms:title": "Results",
      "rdf:value": "<content of results>"
    },
    {
      "@type": "doco:Section",
      "dcterms:title": "Discussion",
      "rdf:value": "<content of discussion>"
    }
  ],
  "cito:cites": [
    {
      "@type": "fabio:JournalArticle",
      "dcterms:title": "<title of cited paper>",
      "dcterms:identifier": "<DOI of cited paper>"
    }
  ]
};