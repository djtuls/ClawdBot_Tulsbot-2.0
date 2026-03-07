// This script adds concurrency control and retries for the cron job to avoid gateway timeouts
const maxRetries = 3;
const retryDelayMs = 2000;

async function runCronJobWithRetries(runFunc) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      await runFunc();
      return; // success
    } catch (error) {
      attempt++;
      if (attempt === maxRetries) {
        throw error;
      }
      // wait before retry
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}

async function exampleCronJob() {
  // example cron logic here
  console.log("Running cron job");
  // simulate random failure
  if (Math.random() < 0.5) {
    throw new Error("Simulated gateway timeout");
  }
}

(async () => {
  try {
    await runCronJobWithRetries(exampleCronJob);
    console.log("Cron job completed successfully");
  } catch (error) {
    console.error("Cron job failed after retries:", error);
  }
})();
