import { wheelStopAngle } from '../motion';

test('every wheel sector lands under the fixed pointer after multiple spins', () => {
  for (const current of [0, 337.5, 1234.5]) {
    for (let sector = 0; sector < 8; sector++) {
      const end = wheelStopAngle(current, sector, 8);
      const sectorCenter = (sector + 0.5) * 45;
      const pointerOffset = ((end + sectorCenter) % 360 + 360) % 360;
      expect(pointerOffset).toBeCloseTo(0, 6);
      expect(end - current).toBeGreaterThanOrEqual(6 * 360);
      expect(end - current).toBeLessThan(7 * 360);
    }
  }
});
