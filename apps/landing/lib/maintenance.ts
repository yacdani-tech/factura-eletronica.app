export function isMaintenanceMode() {
  return process.env.MAINTENANCE_MODE === "true";
}
