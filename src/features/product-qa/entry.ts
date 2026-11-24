import { productQaAllowed } from './guard';
import type { ComponentType } from 'react';

/** No business stores or QA panel are evaluated before both authorization gates. */
export async function loadProductQaPanel(load: () => Promise<{ ProductQaPanel: ComponentType<{ active: boolean }> }>
  = () => import('./ProductQaPanel')) {
  if (!productQaAllowed()) return null;
  const panel = await load();
  return productQaAllowed() ? panel.ProductQaPanel : null;
}
