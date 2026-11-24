import type { BillingCatalog } from '@/core/net';

export type CheckoutInputValidation = 'empty_email' | 'bad_email' | 'consent_required'
  | 'personal_data_consent_required' | 'accepted';
export type CheckoutValidationResult = CheckoutInputValidation | 'profile_unavailable' | 'catalog_unavailable';

/** The same strict receipt-email rules protect both the form and the store. */
export function validEmail(value: string): boolean {
  if (value.length > 254) return false;
  const parts = value.split('@');
  if (parts.length !== 2) return false;
  const [mailbox, domain] = parts;
  const labels = domain.split('.');
  return mailbox.length <= 64
    && /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(mailbox)
    && labels.length >= 2
    && labels.every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));
}

export function validateCheckoutInput(email: string, consented: boolean, personalDataConsented: boolean): CheckoutInputValidation {
  const normalizedEmail = email.trim();
  if (!normalizedEmail) return 'empty_email';
  if (!validEmail(normalizedEmail)) return 'bad_email';
  if (consented !== true) return 'consent_required';
  if (personalDataConsented !== true) return 'personal_data_consent_required';
  return 'accepted';
}

/** Local-only binding: never send the catalog or legal text as telemetry. */
export function subscriptionConsentIdentity(catalog: BillingCatalog | null): string | null {
  if (!catalog) return null;
  const plan = catalog.plan;
  return plan ? JSON.stringify([catalog.provider, catalog.protocol, catalog.merchantLogin, catalog.mode,
    plan.id, plan.title, plan.consentVersion, plan.termsVersion, plan.privacyVersion, plan.consentText,
    plan.userAgreementVersion, plan.personalDataConsentVersion, plan.personalDataConsentText,
    plan.amount, plan.currency, plan.periodDays]) : null;
}
