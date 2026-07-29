export const PHYLAX_CAPTURE_RECEIPT_INVITATION =
  "reply to this message to discuss or act on it";

/**
 * Host-owned capture copy. Model prose never supplies or suppresses the
 * conversation affordance, and repeated rendering remains stable.
 */
export function appendPhylaxCaptureReceiptInvitation(receipt: string): string {
  const trimmed = receipt.trim();
  if (!trimmed) return PHYLAX_CAPTURE_RECEIPT_INVITATION;
  if (trimmed.endsWith(PHYLAX_CAPTURE_RECEIPT_INVITATION)) return trimmed;
  return `${trimmed}\n\n${PHYLAX_CAPTURE_RECEIPT_INVITATION}`;
}
