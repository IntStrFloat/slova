import { isLevelExpansionAudience, LEVEL_EXPANSION_CAMPAIGN } from '../levelExpansionCampaign';
import { resolvePushRoute } from '../routing';

const campaign = require('../../../../backend/scripts/levels-expanded-1000.campaign.json');

describe('level expansion campaign audience', () => {
  it.each([500, 501, 999, 1000])('includes level %i with push consent', (level) => {
    expect(isLevelExpansionAudience(level, true)).toBe(true);
  });

  it.each([1, 499, 1001, 0, -500, 500.5, NaN, Infinity])('excludes level %s', (level) => {
    expect(isLevelExpansionAudience(level, true)).toBe(false);
  });

  it('never enrolls an opted-out player', () => {
    expect(isLevelExpansionAudience(500, false)).toBe(false);
    expect(isLevelExpansionAudience(501, false)).toBe(false);
  });

  it('keeps the sender draft aligned with the client topic and safe home route', () => {
    expect(campaign.status).toBe('draft');
    expect(campaign.id).toBe(LEVEL_EXPANSION_CAMPAIGN.id);
    expect(campaign.topic).toBe(LEVEL_EXPANSION_CAMPAIGN.topic);
    expect(campaign.audience.minCurrentLevel).toBe(LEVEL_EXPANSION_CAMPAIGN.minCurrentLevel);
    expect(campaign.audience.maxCurrentLevel).toBe(LEVEL_EXPANSION_CAMPAIGN.maxCurrentLevel);
    expect(campaign.request.message.data.campaignId).toBe(campaign.id);
    expect(resolvePushRoute({ route: campaign.request.message.data.value })).toBe('/');
  });
});
