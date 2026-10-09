import { useCurrency } from '@/features/currency';

/** Only an applied wallet entry may acknowledge the marathon outbox. */
export function applyMarathonCoinsOnce(id: string, amount: number): boolean {
  const wallet = useCurrency.getState();
  const added = wallet.addOnce(id, 'coins', amount);
  if (!added && !useCurrency.getState().hasApplied(id)) {
    throw new Error('Marathon reward has not reached the wallet');
  }
  return added;
}
