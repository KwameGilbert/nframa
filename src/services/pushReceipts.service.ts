// An Expo ticket only says Expo accepted a push; whether it reached the device is in its receipt, ready about 15
// minutes later. The dispatcher hands every ok ticket here.
export interface ExpoReceiptEntry {
  receiptId: string;
  token: string;
}

// TODO(push step 9): queue these for processExpoReceipts (DeviceNotRegistered → delete the device).
export function enqueueExpoReceipts(entries: ExpoReceiptEntry[]): void {
  void entries;
}
