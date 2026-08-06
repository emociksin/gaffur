import type { Env } from '../env';

export type StockStatus = 'in_stock' | 'out_of_stock' | 'preorder' | 'unknown';

interface StockState {
  confirmed_status: StockStatus;
  candidate_status: StockStatus | null;
  candidate_count: number;
  unknown_streak: number;
  parser_error: number;
}

export interface StockObservationResult {
  confirmedStatus: StockStatus;
  transitioned: boolean;
  fromStatus: StockStatus | null;
  toStatus: StockStatus | null;
  unknownStreak: number;
  parserError: boolean;
}

export function stockStatusFromBoolean(value: boolean | null | undefined): StockStatus {
  return value == null ? 'unknown' : value ? 'in_stock' : 'out_of_stock';
}

export function stockStatusToLegacy(value: StockStatus): number | null {
  if (value === 'in_stock') return 1;
  if (value === 'out_of_stock') return 0;
  return null;
}

export async function applyStockObservation(
  env: Env,
  productId: number,
  currentStatus: StockStatus,
  observedStatus: StockStatus,
  t: number
): Promise<StockObservationResult> {
  await env.DB.prepare(
    `INSERT INTO product_stock_state (product_id, confirmed_status)
     VALUES (?, ?)
     ON CONFLICT(product_id) DO NOTHING`
  ).bind(productId, currentStatus).run();

  const state = (await env.DB.prepare(
    `SELECT confirmed_status, candidate_status, candidate_count, unknown_streak, parser_error
     FROM product_stock_state WHERE product_id = ?`
  ).bind(productId).first<StockState>())!;

  if (observedStatus === 'unknown') {
    const unknownStreak = state.unknown_streak + 1;
    const parserError = unknownStreak >= 3;
    await env.DB.prepare(
      `UPDATE product_stock_state
       SET candidate_status = NULL, candidate_count = 0, unknown_streak = ?, parser_error = ?, last_observed_at = ?
       WHERE product_id = ?`
    ).bind(unknownStreak, parserError ? 1 : 0, t, productId).run();
    return {
      confirmedStatus: state.confirmed_status,
      transitioned: false,
      fromStatus: null,
      toStatus: null,
      unknownStreak,
      parserError,
    };
  }

  if (observedStatus === state.confirmed_status) {
    await env.DB.prepare(
      `UPDATE product_stock_state
       SET candidate_status = NULL, candidate_count = 0, unknown_streak = 0, parser_error = 0, last_observed_at = ?
       WHERE product_id = ?`
    ).bind(t, productId).run();
    return {
      confirmedStatus: state.confirmed_status,
      transitioned: false,
      fromStatus: null,
      toStatus: null,
      unknownStreak: 0,
      parserError: false,
    };
  }

  const candidateCount = state.candidate_status === observedStatus ? state.candidate_count + 1 : 1;
  if (candidateCount < 2) {
    await env.DB.prepare(
      `UPDATE product_stock_state
       SET candidate_status = ?, candidate_count = ?, unknown_streak = 0, parser_error = 0, last_observed_at = ?
       WHERE product_id = ?`
    ).bind(observedStatus, candidateCount, t, productId).run();
    return {
      confirmedStatus: state.confirmed_status,
      transitioned: false,
      fromStatus: null,
      toStatus: null,
      unknownStreak: 0,
      parserError: false,
    };
  }

  const isTransition = state.confirmed_status !== 'unknown';
  if (isTransition) {
    await env.DB.prepare(
      `INSERT INTO stock_transitions
       (product_id, from_status, to_status, confirmed_at, observation_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(productId, state.confirmed_status, observedStatus, t, candidateCount, t).run();
  }
  await env.DB.prepare(
    `UPDATE product_stock_state
     SET confirmed_status = ?, candidate_status = NULL, candidate_count = 0,
         unknown_streak = 0, parser_error = 0, last_observed_at = ?, last_transition_at = ?
     WHERE product_id = ?`
  ).bind(observedStatus, t, isTransition ? t : null, productId).run();

  return {
    confirmedStatus: observedStatus,
    transitioned: isTransition,
    fromStatus: isTransition ? state.confirmed_status : null,
    toStatus: isTransition ? observedStatus : null,
    unknownStreak: 0,
    parserError: false,
  };
}
