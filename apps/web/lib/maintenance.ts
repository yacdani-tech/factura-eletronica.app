export function isMaintenanceMode(): boolean {
  return process.env.MAINTENANCE_MODE === "true";
}
