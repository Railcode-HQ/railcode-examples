// Availability of the named connectors declared by the worker. Linking an
// account is an administrative setup step in Railcode, outside the app.
import { connectors } from "@/lib/railcode";

export async function isToolkitConnected(name: string): Promise<boolean> {
  return (await connectors.list()).some((row) => row.name === name && row.has_tools);
}
