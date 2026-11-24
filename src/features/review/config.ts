// Review is an existing feature. These build flags preserve its policy and history.
export const REVIEW_ENABLED = process.env.EXPO_PUBLIC_RUSTORE_REVIEW_ENABLED !== '0';
export const REVIEW_DIAGNOSTICS_ENABLED = process.env.EXPO_PUBLIC_RUSTORE_REVIEW_DIAGNOSTICS === '1';
