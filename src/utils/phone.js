export function normalizePhone(input) {
  if (input === undefined || input === null) return null;
  let digits = String(input).replace(/[^\d+]/g, '');
  if (!digits) return null;

  digits = digits.replace(/\+/g, '');

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }
  if (digits.startsWith('0')) {
    digits = `62${digits.slice(1)}`;
  } else if (digits.startsWith('8')) {
    digits = `62${digits}`;
  }

  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return `+${digits}`;
}

export function isPhoneLike(input) {
  const digits = String(input || '').replace(/[^\d]/g, '');
  return digits.length >= 8 && digits.length <= 15;
}
