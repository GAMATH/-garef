import { describe, expect, it } from 'vitest';
import { MockMobileMoneyProvider, MOCK_CONFIRMATION_MS } from './payments';
import { computeDeposit, depositForServices, formatMoney } from './money';
import { formatNational, isValidNational, toE164 } from './phone';
import { COUNTRIES } from '@/data/reference';

describe('MockMobileMoneyProvider', () => {
  it('is pending until the customer validates, then succeeds', async () => {
    let t = 1000;
    const p = new MockMobileMoneyProvider('mtn_momo', () => t);
    const { providerRef } = await p.initiate({ amount: 5000, currency: 'XAF', reference: 'KZ-1', phone: '+242061234567' });
    expect(await p.verify(providerRef)).toBe('pending');
    t += MOCK_CONFIRMATION_MS;
    expect(await p.verify(providerRef)).toBe('succeeded');
  });
  it('declines wallets ending in 0000', async () => {
    let t = 0;
    const p = new MockMobileMoneyProvider('airtel_money', () => t);
    const { providerRef } = await p.initiate({ amount: 5000, currency: 'XAF', reference: 'KZ-1', phone: '+242060000000' });
    t += MOCK_CONFIRMATION_MS;
    expect(await p.verify(providerRef)).toBe('failed');
  });
});

describe('money', () => {
  it('formats FCFA with grouped thousands', () => {
    expect(formatMoney(5000)).toBe('5 000 FCFA');
    expect(formatMoney(35000, 'en')).toBe('35,000 FCFA');
  });
  it('computes deposits', () => {
    expect(computeDeposit(25000, { type: 'percent', value: 30 })).toBe(7500);
    expect(computeDeposit(7000, { type: 'percent', value: 20 })).toBe(1400);
    expect(computeDeposit(3000, { type: 'fixed', value: 5000 })).toBe(3000);
    expect(computeDeposit(3000, { type: 'none' })).toBe(0);
    expect(computeDeposit(3000, { type: 'full' })).toBe(3000);
    expect(depositForServices([{ price: 30000, depositRule: { type: 'percent', value: 30 } }, { price: 5000, depositRule: null }], { type: 'percent', value: 20 })).toBe(9000);
  });
});

describe('phone', () => {
  const cg = COUNTRIES.find((c) => c.code === 'CG')!;
  const ci = COUNTRIES.find((c) => c.code === 'CI')!;
  it('validates and normalises local numbers', () => {
    expect(isValidNational('06 123 45 67', cg)).toBe(true);
    expect(isValidNational('06 123', cg)).toBe(false);
    expect(toE164('06 123 45 67', cg)).toBe('+242061234567');
    expect(toE164('+242 06 123 45 67', cg)).toBe('+242061234567');
    expect(formatNational('061234567', cg)).toBe('06 123 45 67');
    expect(formatNational('0707070707', ci)).toBe('07 07 07 07 07');
  });
});
