import { allLandmarks } from '@/core/config/worlds';
import { albumThumbnail } from '../albumThumbnails';

test('every landmark in the album has a lightweight preview', () => {
  expect(allLandmarks().filter((landmark) => !albumThumbnail(landmark.id))).toEqual([]);
});
