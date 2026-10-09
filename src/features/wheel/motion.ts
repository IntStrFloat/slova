/** The wheel turns several full circles and stops with the chosen sector under the top pointer. */
export function wheelStopAngle(currentDegrees: number, sector: number, sectorCount: number, fullTurns = 6): number {
  if (!Number.isFinite(currentDegrees) || !Number.isInteger(sectorCount) || sectorCount < 2
    || !Number.isInteger(sector) || sector < 0 || sector >= sectorCount
    || !Number.isInteger(fullTurns) || fullTurns < 1) {
    throw new Error('Invalid wheel stop');
  }
  const sectorCenter = (sector + 0.5) * 360 / sectorCount;
  const desired = (360 - sectorCenter) % 360;
  const current = ((currentDegrees % 360) + 360) % 360;
  const remainder = (desired - current + 360) % 360;
  return currentDegrees + fullTurns * 360 + remainder;
}
