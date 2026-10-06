import { createLogger } from "../config/logger.js";
import { fetchExpoReceipts, type ExpoReceiptResult } from "./expo.service.js";
import db from "../database/knex.js";
import { pushDeviceModel } from "../models/pushDevice.model.js";

// An Expo ticket only says Expo accepted a push; whether it reached the device is in its receipt, ready about 15
// minutes later. The dispatcher hands every ok ticket here.
export interface ExpoReceiptEntry {
  receiptId: string;
  token: string;
}

const logger = createLogger("app");
const RETENTION_DAYS = 7;

// Queue receipt ids for polling: insert them into the pushReceipts table for the sweep to find later.
// Uses ON CONFLICT DO NOTHING to skip duplicate receipt IDs silently.
export async function enqueueExpoReceipts(entries: ExpoReceiptEntry[]): Promise<void> {
  if (entries.length === 0) return;

  try {
    await db("pushReceipts")
      .insert(
        entries.map(({ receiptId, token }) => ({
          receiptId,
          token,
        })),
      )
      .onConflict("receiptId")
      .ignore();
  } catch (err) {
    logger.warn({ err }, "Failed to enqueue push receipts");
  }
}

// Poll Expo for unhandled receipts and mark them once we know the outcome. Clean up old records.
export async function fetchAndProcessReceipts(): Promise<void> {
  try {
    // Fetch unhandled receipts.
    const unhandled = await db("pushReceipts")
      .select("id", "receiptId", "token")
      .where({ handled: false })
      .orderBy("createdAt", "asc");

    if (unhandled.length === 0) {
      // Clean up old receipts while we're here.
      await cleanupOldReceipts();
      return;
    }

    const receiptIds = unhandled.map((r) => r.receiptId);
    let results: Record<string, ExpoReceiptResult> = {};

    try {
      results = await fetchExpoReceipts(receiptIds);
    } catch (err) {
      logger.warn({ err }, "Failed to fetch receipts from Expo; will retry later");
      return;
    }

    // Process results and mark receipts as handled.
    const gone: string[] = [];

    for (const row of unhandled) {
      const result = results[row.receiptId];
      if (!result) {
        // Expo has no receipt yet; keep it unhandled for the next sweep.
        continue;
      }

      if (!result.ok && result.deviceGone) {
        gone.push(row.token);
      }

      // Mark as handled regardless of the outcome.
      await db("pushReceipts").where({ id: row.id }).update({ handled: true });
    }

    // Delete devices that are gone.
    if (gone.length > 0) {
      await pushDeviceModel
        .removeByTokens(gone)
        .catch((err: { code?: string }) =>
          logger.warn({ code: err.code }, "Failed to remove dead push devices from receipts"),
        );
    }

    // Clean up old receipts.
    await cleanupOldReceipts();
  } catch (err) {
    logger.warn({ err }, "Error in receipt processing sweep");
  }
}

// Remove receipts older than RETENTION_DAYS.
async function cleanupOldReceipts(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  try {
    await db("pushReceipts").where("createdAt", "<", cutoff).delete();
  } catch (err) {
    logger.warn({ err }, "Failed to clean up old push receipts");
  }
}

// Start the receipt sweep on a background interval (non-blocking).
export function startPushReceiptSweep(): void {
  // Run the sweep immediately (fire-and-forget) to catch any pending receipts at startup.
  void fetchAndProcessReceipts();

  // Then run every 60 seconds.
  setInterval(() => {
    void fetchAndProcessReceipts();
  }, 60_000);
}
