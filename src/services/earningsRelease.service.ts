import { createLogger } from "../config/logger.js";
import { walletModel } from "../models/wallet.model.js";

const logger = createLogger("app");
const INTERVAL_MS = 10 * 60_000;

// Moves driver earnings and tips whose hold has ended from pendingBalance into balance.
async function releaseDue(): Promise<void> {
  try {
    const released = await walletModel.releaseDueEarnings();
    if (released > 0) logger.info({ released }, "Released held driver credits");
  } catch (err) {
    logger.warn({ err }, "Error in earnings release sweep");
  }
}

// Runs at startup, then every 10 minutes. A held credit is released at most one interval after its availableAt;
// GET /wallet's nextReleaseAt says when it's due, not when the sweep picks it up.
export function startEarningsReleaseSweep(): void {
  void releaseDue();
  setInterval(() => {
    void releaseDue();
  }, INTERVAL_MS);
}
