export const colors = {
  background: '#0b1120',
  surface: '#141d30',
  raised: '#1c2940',
  border: '#263550',
  text: '#f1f5fc',
  muted: '#96a6bf',
  accent: '#8b80ff',
  positive: '#50c9a2',
  negative: '#f28a97',
  warning: '#e8bb70',
};
export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };
export function money(value: string | number | null | undefined, currency = 'USD') {
  const number = Number(value);
  return value === null || value === undefined || !Number.isFinite(number)
    ? '—'
    : new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(number);
}
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please retry.';
