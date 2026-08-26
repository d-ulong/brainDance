import { logPortStatus } from "./e2e-port.mts";

const port = process.env.PLAYWRIGHT_PORT ?? "3002";
logPortStatus(port);
