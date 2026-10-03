import type { DepositRule, Locale } from './types';

const formatters = new Map<string, Intl.NumberFormat>();

/**
 * Formats an amount in CFA francs: « 5 000 FCFA ».
 * XAF and XOF are both displayed as FCFA locally; amounts have no minor unit.
 */
export function formatMoney(amount: number, locale: Locale = 'fr'): string {
  const key = locale;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: 0 });
    formatters.set(key, f);
  }
  // fr-FR uses a narrow no-break space as group separator; normalise to a regular no-break space.
  return `${f.format(Math.round(amount)).replace(/ /g, ' ')} FCFA`;
}

/** Deposit owed for a booking total under a rule. Rounded up to the nearest 100 FCFA. */
export function computeDeposit(total: number, rule: DepositRule): number {
  let value = 0;
  switch (rule.type) {
    case 'none':
      value = 0;
      break;
    case 'fixed':
      value = rule.value;
      break;
    case 'percent':
      value = Math.ceil((total * rule.value) / 100 / 100) * 100;
      break;
    case 'full':
      value = total;
      break;
  }
  return Math.max(0, Math.min(total, value));
}

/** When several services have their own rules, the strictest (largest) deposit wins. */
export function depositForServices(
  services: { price: number; depositRule: DepositRule | null }[],
  businessRule: DepositRule,
): number {
  const total = services.reduce((s, x) => s + x.price, 0);
  const base = computeDeposit(total, businessRule);
  const perService = services.reduce((s, x) => s + (x.depositRule ? computeDeposit(x.price, x.depositRule) : 0), 0);
  return Math.min(total, Math.max(base, perService));
}
