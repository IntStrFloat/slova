const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

// Addresses accepted by the SMTP transport, checkout and renewal notifications.
function isEmail(value) {
  if (typeof value !== 'string' || value.length > 254 || /[\s\u0000-\u001f\u007f-\u009f]/.test(value)) return false;
  const parts = value.split('@');
  if (parts.length !== 2 || parts[0].length > 64 || !LOCAL_PART.test(parts[0])) return false;
  const labels = parts[1].split('.');
  return labels.length > 1 && labels.every((label) => LABEL.test(label));
}

module.exports = { isEmail };
