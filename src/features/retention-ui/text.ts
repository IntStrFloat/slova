/** Russian count forms for short, truthful progress labels. */
export function ruCount(count: number, one: string, few: string, many: string): string {
  const value = Math.max(0, Math.trunc(count));
  const lastTwo = value % 100;
  const last = value % 10;
  const noun = lastTwo >= 11 && lastTwo <= 14 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many;
  return `${value} ${noun}`;
}
