/**
 * Payment adapters. The MVP ships a mock Mobile Money / card provider; real integrations
 * (Airtel Money, MTN MoMo, Orange Money, Moov Money, Wave, card acquirer) implement the
 * same interface. No card or wallet data is ever stored — only the provider reference.
 */
import type { PaymentOperator } from './types';

export type ProviderId = PaymentOperator | 'card';
export type ProviderStatus = 'pending' | 'succeeded' | 'failed';

export interface InitiateRequest {
  amount: number;
  currency: 'XAF' | 'XOF';
  reference: string;
  phone?: string;
}

export interface PaymentProvider {
  readonly id: ProviderId;
  initiate(req: InitiateRequest): Promise<{ providerRef: string; status: ProviderStatus }>;
  verify(providerRef: string): Promise<ProviderStatus>;
  refund(providerRef: string, amount: number): Promise<void>;
  handleWebhook(payload: unknown): { providerRef: string; status: ProviderStatus };
}

/** Delay before the simulated customer « validates on their phone ». */
export const MOCK_CONFIRMATION_MS = 4000;

/**
 * Mock provider. Outcome is encoded in the reference so verification is stateless and
 * survives reloads: MOCK-<S|F>-<resolveAtMs>-<random>.
 * Rule: a wallet number ending in 0000 is declined (handy for demos and tests).
 */
export class MockMobileMoneyProvider implements PaymentProvider {
  constructor(readonly id: ProviderId, private now: () => number = Date.now) {}

  async initiate(req: InitiateRequest) {
    const declined = !!req.phone && req.phone.replace(/\D/g, '').endsWith('0000');
    const resolveAt = this.now() + MOCK_CONFIRMATION_MS;
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return { providerRef: `MOCK-${declined ? 'F' : 'S'}-${resolveAt}-${rand}`, status: 'pending' as const };
  }

  async verify(providerRef: string): Promise<ProviderStatus> {
    const [, outcome, at] = providerRef.split('-');
    if (this.now() < Number(at)) return 'pending';
    return outcome === 'S' ? 'succeeded' : 'failed';
  }

  async refund() {
    /* mock: nothing to do */
  }

  handleWebhook(payload: unknown) {
    const p = payload as { reference?: string; status?: string };
    return { providerRef: String(p.reference ?? ''), status: p.status === 'SUCCESSFUL' ? ('succeeded' as const) : ('failed' as const) };
  }
}

export function getProvider(id: ProviderId, now?: () => number): PaymentProvider {
  return new MockMobileMoneyProvider(id, now);
}

export const OPERATOR_LABELS: Record<PaymentOperator, string> = {
  airtel_money: 'Airtel Money',
  mtn_momo: 'MTN MoMo',
  orange_money: 'Orange Money',
  moov_money: 'Moov Money',
  wave: 'Wave',
};
