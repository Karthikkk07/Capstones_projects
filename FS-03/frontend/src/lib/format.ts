export const formatMoney = (cents: number, currency = 'USD') =>
  cents === 0 ? 'Free' : new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);

export const formatRevenue = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export const formatDuration = (sec: number | null | undefined) => {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

/** Converts a datetime-local input value to an ISO string. */
export const localInputToIso = (value: string) => new Date(value).toISOString();

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
