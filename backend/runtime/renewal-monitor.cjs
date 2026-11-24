// A support-safe journal summary. Explicit field selection keeps provider
// errors, payment IDs and personal data out of logs, even after API changes.
function createRenewalMonitor({ billing, warn = console.warn }) {
  let previous = null;
  const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  return async function tick() {
    let result = {};
    let diagnostics = {};
    let reconciliationUnavailable = false;
    let diagnosticsUnavailable = false;
    try {
      if (billing.catalog().available) result = await billing.runRenewals();
      else if (typeof billing.reconcilePending === 'function') result = await billing.reconcilePending();
    } catch { reconciliationUnavailable = true; }
    try { diagnostics = billing.diagnostics(); } catch { diagnosticsUnavailable = true; }
    const summary = {
      failures: count(result.failures), blockedNotices: count(result.blockedNotices),
      reconciliationUnavailable, diagnosticsUnavailable,
      pendingPayments: count(diagnostics.pendingPayments), failedPayments: count(diagnostics.failedPayments),
      stalePendingPayments: count(diagnostics.stalePendingPayments),
      pendingRefunds: count(diagnostics.pendingRefunds), manualReconciliationRefunds: count(diagnostics.manualReconciliationRefunds),
      manualReceiptCorrections: count(diagnostics.manualReceiptCorrections),
      manualReconciliationPayments: count(diagnostics.manualReconciliationPayments),
      overdueSubscriptions: count(diagnostics.overdueSubscriptions), invalidEmails: count(diagnostics.invalidEmails),
      notices: { pending: count(diagnostics.notices?.pending), failed: count(diagnostics.notices?.failed),
        quarantined: count(diagnostics.notices?.quarantined) },
    };
    const needsAttention = summary.failures || summary.blockedNotices || reconciliationUnavailable || diagnosticsUnavailable ||
      summary.failedPayments || summary.stalePendingPayments || summary.manualReconciliationPayments || summary.overdueSubscriptions || summary.invalidEmails ||
      summary.notices.failed || summary.notices.quarantined || summary.manualReconciliationRefunds || summary.manualReceiptCorrections;
    const serialized = JSON.stringify(summary);
    if (serialized !== previous && (needsAttention || previous !== null)) warn(`[billing] renewal diagnostics ${serialized}`);
    previous = needsAttention ? serialized : null;
  };
}

module.exports = { createRenewalMonitor };
