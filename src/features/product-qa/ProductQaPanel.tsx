import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { AppButton, AppText, colors } from '@/ui';

import { productQaAllowed } from './guard';
import { getProductQaHarness } from './loadRuntime';
import type { ProductQaHarness, ProductQaSnapshot } from './runtime';

/** Loaded only by an explicit /sdk-qa action after public and exact native-package guards. */
export function ProductQaPanel({ active }: { active: boolean }) {
  const router = useRouter();
  const [harness] = useState<ProductQaHarness | null>(() => productQaAllowed() ? getProductQaHarness() : null);
  const [snapshot, setSnapshot] = useState<ProductQaSnapshot | null>(() => harness?.snapshot() ?? null);
  const [actionStatus, setActionStatus] = useState('not_started');
  useEffect(() => {
    if (!harness) return;
    return harness.subscribe(() => setSnapshot(harness.snapshot()));
    // Wrappers intentionally survive navigation to the actual Game until explicit stop or process death.
  }, [harness]);
  const allowed = active && productQaAllowed() && harness !== null;
  const run = async (action: (value: ProductQaHarness) => boolean | Promise<boolean>) => {
    if (!active || !productQaAllowed() || !harness) return;
    try { setActionStatus(await action(harness) ? 'action_completed' : 'action_denied'); setSnapshot(harness.snapshot()); }
    catch { setActionStatus('qa_action_failed'); setSnapshot(harness.snapshot()); }
  };
  const go = (path: '/game?mode=normal' | '/wheel' | '/shop') => {
    if (!active || !productQaAllowed() || !harness) return;
    const origin = harness.snapshot().originInteractionId;
    if (path === '/wheel' && origin) router.replace({ pathname: '/wheel', params: { helpFlowId: origin } });
    else router.replace(path);
  };
  return <>
    <AppText preset="title" style={{ color: colors.brown }}>Продуктовые сценарии — изолированный QA</AppText>
    <AppText style={{ color: colors.brown }}>Подготовка меняет только профиль .sdkqa. Симуляция не подтверждает vendor callback. P7 остаётся выключен.</AppText>
    <AppText selectable testID="product-qa-state" accessibilityLabel={`Product QA state: ${snapshot?.status ?? 'qa_unavailable'}`} style={{ color: colors.brown }}>
      {JSON.stringify(snapshot ?? { status: 'qa_unavailable' })}
    </AppText>
    <AppText testID="product-qa-action-status" style={{ color: colors.brown }}>{actionStatus}</AppText>
    <AppButton label="Подготовить QA: уровень 6, 20 монет" disabled={!allowed} onPress={() => { void run((value) => value.prepareCampaign()); }} />
    <AppButton label="Симулированная реклама: ready" disabled={!allowed} onPress={() => { void run((value) => value.useSimulation('ready')); }} />
    <AppButton label="Симулированная реклама: loading" disabled={!allowed} onPress={() => { void run((value) => value.useSimulation('loading')); }} />
    <AppButton label="Симулированная реклама: no_fill" disabled={!allowed} onPress={() => { void run((value) => value.useSimulation('no_fill')); }} />
    <AppButton label="В actual Game (QA профиль)" disabled={!allowed || snapshot?.level !== 6} onPress={() => go('/game?mode=normal')} />
    <AppButton label="Настоящая demo: удержать следующий reward" disabled={!allowed} onPress={() => { void run((value) => value.armVendor()); }} />
    <AppText style={{ color: colors.brown }}>Для vendor kill/restart сначала требуется внешнее disk evidence native earned. Этот экран его не подтверждает.</AppText>
    <AppButton label="Синтетический pendingSpin 5: удержать выдачу" disabled={!allowed} onPress={() => { void run((value) => value.prepareSmallSpin()); }} />
    <AppButton label="Открыть actual Wheel" disabled={!allowed} onPress={() => go('/wheel')} />
    <AppButton label="Освободить hold и повторить native recovery" disabled={!allowed} onPress={() => { void run((value) => value.releaseHold()); }} />
    <AppButton label="Открыть P6 форму: без оплаты и preflight" disabled={!allowed} onPress={() => { void run((value) => {
      if (!value.openFormFixture()) return false;
      go('/shop'); return true;
    }); }} />
    <AppButton label="Убрать только QA wrappers" disabled={!allowed} onPress={() => { void run((value) => { value.stop(); return true; }); }} />
    <AppButton label="Обновить QA состояние" disabled={!allowed} onPress={() => { if (allowed && productQaAllowed()) setSnapshot(harness!.snapshot()); }} />
  </>;
}
