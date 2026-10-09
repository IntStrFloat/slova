import { validateLevel, type Level } from '@/core/engine';
import { addDays, daysBetween, isDayKey } from '@/core/time';
import { loadVerifiedReleasedGlobalLevel } from '@/features/levels/loader';

export type DailyVariant = 'starter' | 'standard';

export interface DailyContent {
  puzzleId: string;
  variantId: DailyVariant;
  level: Level;
}

export interface DailyScheduleEntry {
  dateKey: string;
  puzzleId: string;
  variantId: DailyVariant;
  available: boolean;
}

/**
 * Fourteen hand-selected, strict-audited grids per difficulty band. This is a
 * deterministic offline fallback: after 14 dates, its grids rotate again under
 * new date IDs. Publish refreshed verified packs for longer-term variety.
 * Fingerprint locks keep a later campaign regeneration from silently changing
 * fallback content. An opened puzzle stores its full grid across app updates.
 */
const VERIFIED: Record<DailyVariant, readonly [number, string][]> = {
  starter: [
    [5, '120ca0d421d2f0520bcb628c2d8d07b6793270f1cac6c4c13c271f7bca5f251a'],
    [6, '2ec841a4e06a4fdfb4e321d2afc123a6f0836e8db36f4e193aa7ae9fb83c31c7'],
    [7, '279ea67d31d8bcf80938bdfe9303a67dce403d05fd63ad0b0ab9bb6361d9a179'],
    [8, '7a0d9b2bf8386c3c44437b2e716e284e593344fad1727dd8a032e5f16be87ba3'],
    [9, '833900e1cb88b2389ad20313159f94e2862736f6f27a375acb2246c5b03cdf6d'],
    [11, '57bfa2d3d1360e98d21fba4043ac7831e6201ed85f2fb126eb13c18911def8b0'],
    [12, 'fdbc0bdc4af8258c2fb2cb91f8c426174d180e63ca5112636a92eb843756d92d'],
    [13, 'bb2b3a2acfb3b82b068c9802b4b98fa06135b51f3c26c9bed435d78b686467bc'],
    [14, '54a2c0825f415ea98c0fb91ab1053f74593411e0e354c5856c6fb72a26193dea'],
    [15, 'e70753bbfffdd9861c7ab7ee58262c6f43a125252f85458fd205e8d12865e7b2'],
    [16, 'bd6029a7b535bf0b5468cf6fc062f02fcb43e7c3df3cf5c9b64eb86bb84f25ab'],
    [17, '90c63a309f39ce01d11057728b500c746601049c61eb2cc48e6a6bd00a4204fe'],
    [18, 'c7a42dd6dc05cfff7062a1bbf71f85021f49fcd762dd3905d7707490ee26d584'],
    [19, '958a22a764a43b505c79ccaeb2475c15daa0963d244931505b3ef416efe36c78'],
  ],
  standard: [
    [32, '5a875689b90e4217d0354c59fc6bd5d9060d300a67f2d6a464a72e611d5bc8a1'],
    [35, 'fde7cf5374f88b7ac0adb68916da312dc04c750b0521ca999ae8dfbaa1f23cdf'],
    [37, '33e1e086e11f5d71987f5ef1a81dcc3f232ca7838862ec244f00f04d2382da82'],
    [39, 'f84710607eb6d3dc9497771c39f68bd766eb5325d13b07c6a30c255bf5ed8010'],
    [41, '7a66c067a05624280f544fd359393f49eebada2b0b355c5b10f4f88418ce2c2f'],
    [42, 'ef8b8dbc6cbf2980b0e0d27df7803acde1595ac8e7e6f45813de1b4c0bebb5eb'],
    [44, '9f7083fa38e239f64d7517d0ca92e1ac4056dc6eb133bc44532dc21dbf0a5371'],
    [46, 'c35bbe73f837552afca700d55aeba39b1614d82f622c3fccce62d66daa27f414'],
    [56, 'e17fa5392051a7a8b7adf49ca805aa794707280145a058bb57b0969800d37bbe'],
    [57, 'a96e6da220044f2c12be49520753b908bc2bc6f7191587a02d3677085401e2e0'],
    [58, '8708699521b905669f0b30ecfd7afa1b85bc92bf3e33566eb1edd654b7e0f0bf'],
    [59, 'bc566fdbfbaa4eb7bdb083973f3802ad3dd14f8b580685d285c1fae7da59a5a5'],
    [61, '642d2f08c4741e00a50cc3b283baa4205884d42d361eacd11cbcc73b6d6b9e9c'],
    [63, '0b8878bc1ab71cd63d90b8888e3d7aefb5fa79f3159b0ed459477841e96d1aa3'],
  ],
};

const SCHEDULE_ANCHOR = '2026-01-01';
export const DAILY_SCHEDULE_DAYS = 14;

function selection(date: string, variant: DailyVariant): { id: number; fingerprint: string; puzzleId: string } | null {
  if (!isDayKey(date) || !VERIFIED[variant]) return null;
  const offset = daysBetween(SCHEDULE_ANCHOR, date);
  const index = ((offset % DAILY_SCHEDULE_DAYS) + DAILY_SCHEDULE_DAYS) % DAILY_SCHEDULE_DAYS;
  const [id, fingerprint] = VERIFIED[variant][index];
  return { id, fingerprint, puzzleId: `daily:v1:${date}:${variant}:${index}` };
}

export function selectDailyContent(date: string, variant: DailyVariant): DailyContent | null {
  const selected = selection(date, variant);
  if (!selected) return null;
  const level = loadVerifiedReleasedGlobalLevel(selected.id, selected.fingerprint);
  if (!level || level.fingerprint !== selected.fingerprint || !validateLevel(level).ok) return null;
  if (level.mechanic !== 'classic' || level.milestone) return null;
  // Store a copy of the verified grid for a started date, independently of the pack.
  return { puzzleId: selected.puzzleId, variantId: variant, level: JSON.parse(JSON.stringify(level)) as Level };
}

/** Materialized rolling offline schedule; unavailable entries remain explicit. */
export function dailySchedule(start: string, variant: DailyVariant): DailyScheduleEntry[] {
  if (!isDayKey(start)) return [];
  return Array.from({ length: DAILY_SCHEDULE_DAYS }, (_, offset) => {
    const dateKey = addDays(start, offset);
    const selected = selection(dateKey, variant)!;
    return {
      dateKey,
      puzzleId: selected.puzzleId,
      variantId: variant,
      available: selectDailyContent(dateKey, variant) !== null,
    };
  });
}
