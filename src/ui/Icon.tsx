import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

import { colors } from './theme';

export type IconName =
  | 'play'
  | 'coin'
  | 'bulb'
  | 'shuffle'
  | 'wand'
  | 'back'
  | 'daily'
  | 'wheel'
  | 'collection'
  | 'shop'
  | 'leaderboard'
  | 'events'
  | 'teams'
  | 'profile'
  | 'settings'
  | 'check';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

const MAP: Record<IconName, IoniconName> = {
  play: 'play',
  coin: 'cash',
  bulb: 'bulb',
  shuffle: 'shuffle',
  wand: 'color-wand',
  back: 'chevron-back',
  daily: 'calendar',
  wheel: 'disc',
  collection: 'images',
  shop: 'bag-handle',
  leaderboard: 'trophy',
  events: 'flag',
  teams: 'people',
  profile: 'person',
  settings: 'settings',
  check: 'checkmark-circle',
};

/** Единый источник иконок (векторные, без эмодзи — спека 04). */
export function Icon({
  name,
  size = 24,
  color = colors.text,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return <Ionicons name={MAP[name]} size={size} color={color} />;
}
