import { Service, IAgentRuntime, logger } from "@elizaos/core";
import { hypGenEvalLoop, stopHypGenEvalLoop } from "./anthropic/hypGenEvalLoop";
import { watchFolderChanges } from "./gdrive";
import { sql, eq } from "drizzle-orm";
import { fileMetadataTable, fileStatusEnum } from "src/db/schemas";
import { downloadFile, initDriveClient, FileInfo } from "./gdrive";
import { generateKaFromPdfBuffer } from "./kaService/kaService";
import { storeJsonLd } from "./gdrive/storeJsonLdToKg"; 
// ^ Make sure this is your UPDATED version that also stores to DKG and returns { success, ual }

// Import DKG so we can instantiate the DKG client
import DKG from "dkg.js";

export class HypothesisService extends Service {
  static serviceType = "hypothesis";
  capabilityDescription = "Generate and judge hypotheses";

  constructor(protected runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime) {
    logger.info("*** Starting hypotheses service ***");
    const service = new HypothesisService(runtime);

    // (Optional) Start your hypothesis generation loop
    const interval = await hypGenEvalLoop(runtime);

    // Register a worker for PROCESS_PDF tasks
    runtime.registerTaskWorker({
      name: "PROCESS_PDF",
      async execute(runtime, options, task) {
        // Mark the task as updated
        await runtime.updateTask(task.id, {
          metadata: {
            updatedAt: Date.now(),
          },
        });

        // Grab the file ID from the task metadata
        const fileId = task.metadata.fileId as string;
        const fileInfo: FileInfo = { id: fileId };

        // Initialize GDrive client & download the file
        const drive = await initDriveClient();
        logger.info("Downloading file from Google Drive...");
        const fileBuffer = await downloadFile(drive, fileInfo);

        // Generate the knowledge assembly (KA) from PDF
        logger.info("Generating KA from PDF buffer...");
        const ka = await generateKaFromPdfBuffer(fileBuffer, runtime);

        // ----------------------------------------
        // 1) Initialize your DKG client
        // ----------------------------------------
        const dkgClient = new DKG({
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

        // ----------------------------------------
        // 2) Store KA in both Oxigraph & DKG (via storeJsonLd)
        // ----------------------------------------
        try {
          // Call your updated storeJsonLd with the KA + dkgClient
          const { success, ual } = await storeJsonLd(ka, dkgClient);

          // Check if storing to DKG was successful
          if (success && ual) {
            logger.info(`Successfully stored KA in DKG! UAL: ${ual}`);
          } else {
            logger.error("Failed to store KA in DKG (no success or no UAL).");
          }
        } catch (error) {
          logger.error("Error storing KA in knowledge graph:", error);
        }

        logger.info("PROCESS_PDF task worker finished.");

        // Mark the task as complete (or delete it, etc.)
        await runtime.deleteTask(task.id);

        // Update your file status in the DB
        await runtime.db
          .update(fileMetadataTable)
          .set({ status: "processed" })
          .where(eq(fileMetadataTable.id, fileId));
      },
    });

    // ----- EXAMPLE: Creating a recurring "HGE" (hypothesis generation) task -----
    // const tasks = await runtime.getTasksByName("HGE");
    // if (tasks.length < 1) {
    //   const taskId = await runtime.createTask({
    //     name: "HGE",
    //     description: "Generate and evaluate hypothesis whilst streaming them to discord",
    //     tags: ["hypothesis", "judgeLLM"],
    //     metadata: { updateInterval: 1500, updatedAt: Date.now() },
    //   });
    //   logger.info("Task UUID:", taskId);
    // }

    // ---- Task processing loop example ----
    async function processRecurringTasks() {
      logger.info("Starting processing loop");
      const now = Date.now();
      const recurringTasks = await runtime.getTasks({
        tags: ["hypothesis"],
      });
      logger.info("Got tasks", recurringTasks);

      for (const task of recurringTasks) {
        if (!task.metadata?.updateInterval) continue;
        const lastUpdate = (task.metadata.updatedAt as number) || 0;
        const interval = task.metadata.updateInterval;

        if (now >= lastUpdate + interval) {
          logger.info(`Executing recurring task: ${task.name}`);
          const worker = runtime.getTaskWorker(task.name);
          if (worker) {
            try {
              await worker.execute(runtime, {}, task);
              // Update the task's last update time
              await runtime.updateTask(task.id, {
                metadata: {
                  ...task.metadata,
                  updatedAt: now,
                },
              });
            } catch (error) {
              logger.error(`Error executing task ${task.name}: ${error}`);
            }
          }
        }
      }
    }

    // Check recurring tasks every 3 minutes
    setInterval(async () => {
      await processRecurringTasks();
    }, 3 * 60 * 1000);

    // If you want to watch a GDrive folder for new PDFs:
    // await watchFolderChanges(runtime);

    // Graceful shutdown on Ctrl-C
    process.on("SIGINT", async () => {
      stopHypGenEvalLoop(interval);
    });

    return service;
  }

  static async stop(runtime: IAgentRuntime) {
    logger.info("*** Stopping hypotheses service ***");
    const service = runtime.getService(HypothesisService.serviceType);
    if (!service) {
      throw new Error("Hypotheses service not found");
    }
    service.stop();
  }

  async stop() {
    logger.info("*** Stopping hypotheses service instance ***");
  }
}
