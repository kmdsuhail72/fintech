import type { MarketDataProvider, MarketInstrument, MarketQuote } from './types.js';

export type RandomSource = () => number;

const simulationParameters: Record<string, { volatility: number; volumePerTick: number }> = {
  AAPL: { volatility: 0.0008, volumePerTick: 1200 },
  MSFT: { volatility: 0.0008, volumePerTick: 600 },
  NVDA: { volatility: 0.0018, volumePerTick: 600 },
  AMZN: { volatility: 0.0008, volumePerTick: 600 },
  GOOGL: { volatility: 0.0008, volumePerTick: 600 },
  META: { volatility: 0.0008, volumePerTick: 600 },
  TSLA: { volatility: 0.0018, volumePerTick: 600 },
  SPY: { volatility: 0.0008, volumePerTick: 1200 },
};

const clampUnit = (value: number) => Math.min(1 - Number.EPSILON, Math.max(Number.EPSILON, value));
const priceString = (value: number) => value.toFixed(8);

function normalRandom(random: RandomSource) {
  const u1 = clampUnit(random());
  const u2 = clampUnit(random());
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export class SimulatedMarketDataProvider implements MarketDataProvider {
  readonly name = 'synthetic-simulator';

  constructor(private readonly random: RandomSource = Math.random) {}

  async generateQuote(
    instrument: MarketInstrument,
    previous: MarketQuote | null,
    now: Date,
  ): Promise<MarketQuote> {
    let reference = previous ?? instrument.latestQuote;
    if (previous && previous.timestamp.slice(0, 10) !== now.toISOString().slice(0, 10)) {
      reference = {
        ...previous,
        open: previous.price,
        high: previous.price,
        low: previous.price,
        previousClose: previous.price,
        change: '0.00000000',
        changePercent: '0.00000000',
        volume: 0,
      };
    }

    const { volatility, volumePerTick } = simulationParameters[instrument.symbol] ?? {
      volatility: 0.0008,
      volumePerTick: 600,
    };
    const randomMovement = normalRandom(this.random) * volatility;
    const boundedMovement = Math.max(-0.0075, Math.min(0.0075, randomMovement));
    const rawPrice = Math.max(0.01, Number(reference.price) * (1 + boundedMovement));
    const price = Number(rawPrice.toFixed(8));
    const previousClose = Number(reference.previousClose);
    const change = Number((price - previousClose).toFixed(8));
    const changePercent = Number(((change / previousClose) * 100).toFixed(8));
    const tickVolume = Math.max(
      1,
      Math.round(volumePerTick * (0.25 + clampUnit(this.random()) * 1.5)),
    );

    return {
      symbolId: instrument.id,
      symbol: instrument.symbol,
      currency: instrument.quoteCurrency,
      price: priceString(price),
      open: reference.open,
      high: priceString(Math.max(Number(reference.high), price)),
      low: priceString(Math.min(Number(reference.low), price)),
      previousClose: reference.previousClose,
      change: priceString(change),
      changePercent: changePercent.toFixed(8),
      volume: reference.volume + tickVolume,
      timestamp: now.toISOString(),
      quoteStatus: 'SIMULATED',
      source: this.name,
    };
  }
}
