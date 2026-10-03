// Supabase Edge Function: payments
// Routes online payments through PaymentProvider adapters. The MVP registers the mock provider for
// every operator; real Airtel Money / MTN MoMo / Orange Money / Moov Money / Wave / card adapters
// implement the same interface and plug into `providers` below.
//
//   POST { action: 'initiate', appointmentId, option, method, operator?, phone? }
//   POST { action: 'webhook', provider, payload }   ← called by the operator
// Deploy: supabase functions deploy payments
import { createClient } from 'npm:@supabase/supabase-js@2';

type Status = 'pending' | 'succeeded' | 'failed';
interface PaymentProvider {
  id: string;
  initiate(req: { amount: number; reference: string; phone?: string }): Promise<{ providerRef: string; status: Status }>;
  verify(ref: string): Promise<Status>;
  refund(ref: string, amount: number): Promise<void>;
  handleWebhook(payload: unknown): { providerRef: string; status: Status };
}

/** Mock: the database decides the outcome (start_payment / verify_payment), so this adapter is a pass-through. */
class MockMobileMoneyProvider implements PaymentProvider {
  constructor(public id: string) {}
  async initiate() { return { providerRef: 'db-managed', status: 'pending' as const }; }
  async verify() { return 'pending' as const; }
  async refund() {}
  handleWebhook(payload: unknown) {
    const p = payload as { reference: string; status: string };
    return { providerRef: p.reference, status: p.status === 'SUCCESSFUL' ? ('succeeded' as const) : ('failed' as const) };
  }
}

const providers: Record<string, PaymentProvider> = Object.fromEntries(
  ['airtel_money', 'mtn_momo', 'orange_money', 'moov_money', 'wave', 'card'].map((id) => [id, new MockMobileMoneyProvider(id)]),
);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const body = await req.json().catch(() => ({}));

  if (body.action === 'initiate') {
    const providerId = body.method === 'card' ? 'card' : body.operator;
    const provider = providers[providerId];
    if (!provider) return json({ error: 'FORBIDDEN' }, 400);
    const { data, error } = await admin.rpc('start_payment', {
      p_appointment_id: body.appointmentId, p_option: body.option, p_method: body.method, p_provider: providerId, p_phone: body.phone ?? null,
    });
    if (error) return json({ error: error.message }, 400);
    // A real adapter would call provider.initiate() here and store the operator reference.
    return json(data);
  }

  if (body.action === 'webhook') {
    const provider = providers[body.provider];
    if (!provider) return json({ error: 'FORBIDDEN' }, 400);
    // TODO(prod): verify the operator signature before trusting the payload.
    const { providerRef, status } = provider.handleWebhook(body.payload);
    const { data: payment } = await admin.from('payments').select('id').eq('provider_ref', providerRef).maybeSingle();
    if (!payment) return json({ error: 'NOT_FOUND' }, 404);
    await admin.rpc('apply_payment_result', { p_payment_id: payment.id, p_success: status === 'succeeded' });
    return json({ ok: true });
  }

  return json({ error: 'UNKNOWN' }, 400);
});
