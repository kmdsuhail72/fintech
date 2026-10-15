import { FinancialChart } from '../components/financial-chart/FinancialChart.js';
import { RANGE_REQUESTS } from '../components/financial-chart/model.js';
import type { ChartRange } from '../components/financial-chart/model.js';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, X } from 'lucide-react';
import { PageTitle } from '../MarketUI.js';
import { fmt, instruments } from '../marketData.js';
import { calculateAtr, calculateRsi } from './indicators.js';
import { requestApi } from '../api.js';
import { getAccessToken, useAuthSessionVersion } from '../authToken.js';
import {
  TradingWatchlist,
  TradingError,
  OrderPanel,
  TradingActivity,
  ConfirmTradeModal,
} from './TradingComponents.js';
import type {
  TradingInstrument,
  TradingQuote,
  TradingCandleResponse,
  TradingWatchlistData,
  TradingPortfolio,
  TradingOrder,
  TradingFill,
} from './TradingComponents.js';
export function TradingPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const symbol = searchParams.get('symbol')?.toUpperCase() ?? 'AAPL';
  const setSymbol = (value: string) => setSearchParams({ symbol: value });
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [quantity, setQuantity] = useState('10');
  const [tab, setTab] = useState<'OPEN' | 'ORDERS' | 'TRADES'>('OPEN');
  const [chartRange, setChartRange] = useState<ChartRange>('1D');
  const { interval, limit } = RANGE_REQUESTS[chartRange];
  const [chartType, setChartType] = useState<'CANDLE' | 'LINE'>('CANDLE');
  const [review, setReview] = useState<{
    symbol: string;
    symbolId: string;
    side: 'BUY' | 'SELL';
    quantity: string;
    price: number;
    portfolioId: string;
    idempotencyKey: string;
  } | null>(null);
  const [watchlistId, setWatchlistId] = useState('');
  const [toast, setToast] = useState('');
  const authenticated = Boolean(getAccessToken());
  const accountScope = useAuthSessionVersion();
  const symbolsQuery = useQuery({
    queryKey: ['trading-symbols'],
    queryFn: ({ signal }) =>
      requestApi<TradingInstrument[]>('/market/symbols?limit=100&offset=0', { signal }),
    staleTime: 60_000,
  });
  const instrumentRows: TradingInstrument[] = symbolsQuery.data?.length
    ? symbolsQuery.data
    : instruments.map((item) => ({
        symbol: item.symbol,
        company_name: item.name,
        exchange_code: item.exchange,
      }));
  const watchlistsQuery = useQuery({
    queryKey: ['trading-watchlists', accountScope],
    queryFn: ({ signal }) => requestApi<TradingWatchlistData[]>('/watchlists', { signal }),
    enabled: authenticated,
    staleTime: 10_000,
  });
  const watchlists = watchlistsQuery.data ?? [];
  const watchlist = watchlists.find((item) => item.id === watchlistId) ?? watchlists[0];
  const watchlistRows: TradingInstrument[] = authenticated
    ? (watchlist?.items ?? []).map((item) => ({
        ...instrumentRows.find((instrument) => instrument.symbol === item.symbol),
        id: item.symbolId,
        symbol: item.symbol,
        company_name: item.companyName,
      }))
    : instrumentRows;
  const asset =
    instrumentRows.find((item) => item.symbol === symbol) ??
    watchlistRows.find((item) => item.symbol === symbol) ??
    instrumentRows[0]!;
  const quoteSymbols = [...new Set([asset.symbol, ...watchlistRows.map((item) => item.symbol)])]
    .slice(0, 50)
    .join(',');
  const quotesQuery = useQuery({
    queryKey: ['trading-quotes', quoteSymbols],
    queryFn: ({ signal }) =>
      requestApi<TradingQuote[]>(`/market/snapshots?symbols=${encodeURIComponent(quoteSymbols)}`, {
        signal,
      }),
    refetchInterval: 4_000,
  });
  const quote = quotesQuery.data?.find((item) => item.symbol === asset.symbol);
  const currentPrice = Number(
    quote?.price ?? instruments.find((item) => item.symbol === asset.symbol)?.price ?? 0,
  );
  const percentChange = Number(
    quote?.changePercent ?? instruments.find((item) => item.symbol === asset.symbol)?.change ?? 0,
  );
  const historyQuery = useQuery({
    queryKey: ['trading-history', asset.symbol, interval, limit],
    queryFn: ({ signal }) =>
      requestApi<TradingCandleResponse>(
        `/market/quotes/${encodeURIComponent(asset.symbol)}/candles?interval=${interval}&limit=${limit}`,
        { signal },
      ),
    refetchInterval: 15_000,
  });
  const candles = useMemo(
    () =>
      (historyQuery.data?.candles ?? []).map((point) => ({
        time: new Date(point.timestamp).toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        open: Number(point.open),
        high: Number(point.high),
        low: Number(point.low),
        close: Number(point.close),
      })),
    [historyQuery.data],
  );
  const financialBars = useMemo(
    () =>
      (historyQuery.data?.candles ?? []).map((point) => ({
        time: Math.floor(Date.parse(point.timestamp) / 1000),
        open: Number(point.open),
        high: Number(point.high),
        low: Number(point.low),
        close: Number(point.close),
        ...(point.volume === undefined || point.volume === null
          ? {}
          : { volume: Number(point.volume) }),
      })),
    [historyQuery.data],
  );
  const privateOptions = { enabled: authenticated, staleTime: 10_000 };
  const portfolioQuery = useQuery({
    queryKey: ['trading-portfolio', accountScope],
    queryFn: ({ signal }) => requestApi<TradingPortfolio[]>('/portfolio', { signal }),
    ...privateOptions,
  });
  const ordersQuery = useQuery({
    queryKey: ['trading-orders', accountScope],
    queryFn: ({ signal }) => requestApi<TradingOrder[]>('/orders?limit=50&offset=0', { signal }),
    ...privateOptions,
  });
  const tradesQuery = useQuery({
    queryKey: ['trading-trades', accountScope],
    queryFn: ({ signal }) => requestApi<TradingFill[]>('/trades?limit=50&offset=0', { signal }),
    ...privateOptions,
  });
  const portfolio = portfolioQuery.data?.[0];
  const position = portfolio?.positions.find((item) => item.symbol === asset.symbol);
  const mutation = useMutation({
    mutationFn: async (draft: NonNullable<typeof review>) => {
      if (!draft.symbolId)
        throw new Error('Symbol details are unavailable. Refresh market data and try again.');
      return requestApi<TradingOrder>('/orders', {
        method: 'POST',
        body: {
          portfolioId: draft.portfolioId,
          symbolId: draft.symbolId,
          side: draft.side,
          quantity: draft.quantity,
          idempotencyKey: draft.idempotencyKey,
        },
      });
    },
    onError: async () => {
      // A response can be lost after execution; refresh account state before retrying.
      await Promise.all(
        ['trading-orders', 'trading-trades', 'trading-portfolio'].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      );
    },
    onSuccess: async (order) => {
      setReview(null);
      setToast(
        `${order.side} ${order.quantity} ${order.symbol}: ${order.status.toLowerCase().replaceAll('_', ' ')}.`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['trading-orders'] }),
        queryClient.invalidateQueries({ queryKey: ['trading-trades'] }),
        queryClient.invalidateQueries({ queryKey: ['trading-portfolio'] }),
      ]);
    },
  });
  const cancelMutation = useMutation({
    mutationFn: (orderId: string) => requestApi(`/orders/${orderId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setToast('Paper order cancelled.');
      await Promise.all(
        ['trading-orders', 'trading-portfolio', 'trading-trades'].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      );
    },
  });
  const watchlistMutation = useMutation({
    mutationFn: async () => {
      if (!asset.id) throw new Error('Wait for symbol details to load.');
      if (watchlistRows.some((item) => item.symbol === asset.symbol) && watchlist) {
        await requestApi(`/watchlists/${watchlist.id}/items/${asset.id}`, { method: 'DELETE' });
        return `Removed ${asset.symbol} from your saved watchlist.`;
      }
      const target =
        watchlist ??
        (await requestApi<{ id: string }>('/watchlists', {
          method: 'POST',
          body: { name: 'My watchlist' },
        }));
      await requestApi(`/watchlists/${target.id}/items`, {
        method: 'POST',
        body: { symbolId: asset.id },
      });
      return `Saved ${asset.symbol} to your watchlist.`;
    },
    onSuccess: async (message) => {
      setToast(message);
      await queryClient.invalidateQueries({ queryKey: ['trading-watchlists'] });
    },
  });
  const orderError = mutation.error instanceof Error ? mutation.error.message : undefined;
  const portfolioError =
    portfolioQuery.error instanceof Error ? portfolioQuery.error.message : undefined;
  const activityError = tab === 'TRADES' ? tradesQuery.error : ordersQuery.error;
  const availableCash =
    portfolio?.cash_balance === undefined ? undefined : Number(portfolio.cash_balance);
  const normalizedQuantity = Number(quantity);
  const validQuantity =
    /^(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/.test(quantity) && normalizedQuantity > 0;
  const validationError = !validQuantity
    ? 'Enter a positive quantity with up to 8 decimal places.'
    : !quote ||
        quotesQuery.isError ||
        !Number.isFinite(Number(quote.price)) ||
        Number(quote.price) <= 0 ||
        quote.quoteStatus === 'STALE' ||
        !quote.timestamp ||
        !Number.isFinite(Date.parse(quote.timestamp)) ||
        Date.now() - Date.parse(quote.timestamp) > 60_000
      ? 'Wait for a fresh market quote before trading.'
      : (quote.currency ?? asset.quote_currency ?? 'USD') !== 'USD' ||
          (portfolio && portfolio.base_currency !== 'USD')
        ? 'This ticket currently supports USD paper portfolios and symbols.'
        : portfolioQuery.isError || availableCash === undefined || !Number.isFinite(availableCash)
          ? 'Load your portfolio balance before placing an order.'
          : side === 'BUY' && normalizedQuantity * currentPrice > availableCash
            ? 'Insufficient available balance for this order.'
            : side === 'SELL' && normalizedQuantity > Number(position?.quantity ?? 0)
              ? 'Quantity exceeds your available shares.'
              : undefined;

  return (
    <div className="workspace-page trading-workspace">
      <PageTitle
        eyebrow="PAPER EXECUTION"
        title="Trading terminal"
        subtitle="A focused workspace for simulated market orders and portfolio activity."
        action={
          <span className="data-status simulated">
            <span className="status-dot" /> Simulated market
          </span>
        }
      />
      <div className="trading-terminal-grid">
        <TradingWatchlist
          instruments={watchlistRows}
          watchlists={authenticated ? watchlists : []}
          watchlistId={watchlist?.id ?? ''}
          onWatchlistChange={setWatchlistId}
          onRetry={() => {
            void watchlistsQuery.refetch();
            void quotesQuery.refetch();
          }}
          authenticated={authenticated}
          onToggleSymbol={() => watchlistMutation.mutate()}
          saving={watchlistMutation.isPending}
          canSave={Boolean(asset.id) && !watchlistsQuery.isLoading && !watchlistsQuery.isError}
          quotes={quotesQuery.data ?? []}
          selected={asset.symbol}
          onSelect={setSymbol}
          loading={authenticated ? watchlistsQuery.isLoading : symbolsQuery.isLoading}
          error={
            watchlistMutation.error instanceof Error
              ? watchlistMutation.error.message
              : watchlistsQuery.error instanceof Error
                ? 'Could not load your saved watchlists.'
                : quotesQuery.error instanceof Error
                  ? 'Market quotes are unavailable.'
                  : undefined
          }
        />
        <div className="trading-center-column">
          <div className="trading-asset-summary">
            <div>
              <span className="eyebrow">
                {asset.exchange_code ?? 'US MARKET'} <span className="eyebrow-separator">·</span>{' '}
                EQUITY
              </span>
              <h2>{asset.company_name ?? asset.symbol}</h2>
              <p>
                {asset.symbol} <span>·</span> Quote currency {asset.quote_currency ?? 'USD'}
              </p>
            </div>
            <div className="trading-summary-price">
              <strong>{fmt(currentPrice)}</strong>
              <span className={percentChange >= 0 ? 'positive' : 'negative'}>
                {percentChange >= 0 ? '+' : ''}
                {percentChange.toFixed(2)}% today
              </span>
              <small>
                {quote?.timestamp
                  ? `Updated ${new Date(quote.timestamp).toLocaleTimeString()}`
                  : 'Illustrative quote preview'}
              </small>
            </div>
          </div>
          {symbolsQuery.error && (
            <TradingError message="Market symbol service is unavailable; showing the supported demo symbols." />
          )}
          <div className="panel">
            <FinancialChart
              symbol={asset.symbol}
              currency={asset.quote_currency ?? 'USD'}
              data={financialBars}
              loading={historyQuery.isLoading}
              error={historyQuery.error instanceof Error ? historyQuery.error.message : undefined}
              onRetry={() => void historyQuery.refetch()}
              range={chartRange}
              onRangeChange={setChartRange}
              chartType={chartType === 'CANDLE' ? 'candlestick' : 'line'}
              onChartTypeChange={(value) => setChartType(value === 'line' ? 'LINE' : 'CANDLE')}
            />
          </div>
          <section className="panel indicator-detail-panel">
            <div className="trading-panel-heading">
              <div>
                <span className="eyebrow">TECHNICALS</span>
                <h2>Technical indicators</h2>
              </div>
              <span className="trading-muted-label">Calculated from simulated price history</span>
            </div>
            <div className="indicator-cards">
              <div>
                <span>Trend · SMA (20)</span>
                <strong>
                  {candles.length
                    ? fmt(
                        candles.slice(-20).reduce((sum, candle) => sum + candle.close, 0) /
                          Math.min(20, candles.length),
                      )
                    : '—'}
                </strong>
                <small>
                  {!candles.length
                    ? 'Waiting for recorded prices'
                    : currentPrice >=
                        candles.slice(-20).reduce((sum, candle) => sum + candle.close, 0) /
                          Math.max(Math.min(20, candles.length), 1)
                      ? 'Price above average'
                      : 'Price below average'}
                </small>
              </div>
              <div>
                <span>Momentum · RSI (14)</span>
                <strong>{candles.length > 1 ? calculateRsi(candles).toFixed(1) : '—'}</strong>
                <small>Relative strength index</small>
              </div>
              <div>
                <span>Volatility · ATR</span>
                <strong>{candles.length ? fmt(calculateAtr(candles)) : '—'}</strong>
                <small>14-period average range</small>
              </div>
            </div>
          </section>
        </div>
        <div className="trading-right-column">
          <OrderPanel
            instrument={asset}
            price={currentPrice}
            change={percentChange}
            side={side}
            quantity={quantity}
            availableCash={availableCash}
            availableShares={Number(position?.quantity ?? 0)}
            validationError={authenticated ? validationError : undefined}
            balanceLoading={portfolioQuery.isLoading}
            isAuthenticated={authenticated}
            submitting={mutation.isPending}
            onSideChange={setSide}
            onQuantityChange={setQuantity}
            onReview={() => {
              if (validationError || !asset.id || !portfolio) return;
              mutation.reset();
              setReview({
                symbol: asset.symbol,
                symbolId: asset.id,
                side,
                quantity: quantity.trim(),
                price: currentPrice,
                portfolioId: portfolio.portfolio_id,
                idempotencyKey: crypto.randomUUID(),
              });
            }}
          />
          {portfolioError && (
            <TradingError
              message={`Portfolio unavailable: ${portfolioError}`}
              onRetry={() => void portfolioQuery.refetch()}
            />
          )}
          {orderError && <TradingError message={orderError} />}
        </div>
      </div>
      <TradingActivity
        tab={tab}
        onTabChange={setTab}
        orders={ordersQuery.data ?? []}
        trades={tradesQuery.data ?? []}
        loading={
          authenticated && (tab === 'TRADES' ? tradesQuery.isLoading : ordersQuery.isLoading)
        }
        error={activityError instanceof Error ? activityError.message : undefined}
        onCancel={(orderId) => cancelMutation.mutate(orderId)}
        cancellingId={cancelMutation.isPending ? cancelMutation.variables : undefined}
        onRefresh={() => {
          if (authenticated)
            void (tab === 'TRADES' ? tradesQuery.refetch() : ordersQuery.refetch());
        }}
      />
      {cancelMutation.error instanceof Error && (
        <TradingError message={`Could not cancel order: ${cancelMutation.error.message}`} />
      )}
      {review && (
        <ConfirmTradeModal
          symbol={review.symbol}
          side={review.side}
          quantity={Number(review.quantity)}
          price={review.price}
          busy={mutation.isPending}
          onClose={() => setReview(null)}
          onConfirm={() => {
            mutation.mutate(review);
          }}
          error={orderError}
        />
      )}
      {toast && (
        <div className="trade-success-toast" role="status">
          <CheckCircle2 size={17} /> {toast}
          <button type="button" aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
