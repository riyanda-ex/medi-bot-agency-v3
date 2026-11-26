export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.ENABLE_SCHEDULER !== "true") {
    return;
  }
  const { startScheduler } = await import("./agents/orchestrator");
  startScheduler();
}
