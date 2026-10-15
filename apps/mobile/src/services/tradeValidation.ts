import type { Quote } from './types';
function units(value: string) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole! + fraction.padEnd(8, '0'));
}
export function validateTrade(input: {
  quantity: string;
  side: 'BUY' | 'SELL';
  cash: string | undefined;
  shares: string;
  quote: Quote | undefined;
  currency: string | undefined;
  now?: number;
}) {
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/.test(input.quantity) || Number(input.quantity) <= 0)
    return 'Enter a positive quantity with up to 8 decimal places.';
  const quote = input.quote;
  if (
    !quote ||
    !Number.isFinite(Number(quote.price)) ||
    Number(quote.price) <= 0 ||
    quote.quoteStatus === 'STALE' ||
    !Number.isFinite(Date.parse(quote.timestamp)) ||
    (input.now ?? Date.now()) - Date.parse(quote.timestamp) > 60000
  )
    return 'A fresh market quote is required.';
  if (input.cash === undefined || !Number.isFinite(Number(input.cash)))
    return 'Load your portfolio balance before trading.';
  if (input.currency !== quote.currency)
    return 'Currency conversion is not enabled for this portfolio.';
  const quantityUnits = units(input.quantity);
  const priceUnits = units(String(quote.price));
  const cashUnits = units(input.cash);
  const shareUnits = units(input.shares);
  if (quantityUnits === null || priceUnits === null || cashUnits === null)
    return 'Account amounts are unavailable. Refresh your portfolio.';
  const ledgerValue = (quantityUnits * priceUnits + 500000000000n) / 1000000000000n;
  if (ledgerValue <= 0n) return 'Trade value is below the supported minimum.';
  if (input.side === 'BUY' && ledgerValue * 10000n > cashUnits)
    return 'Insufficient available virtual balance.';
  if (input.side === 'SELL' && (shareUnits === null || quantityUnits > shareUnits))
    return 'Quantity exceeds your available shares.';
  return null;
}
