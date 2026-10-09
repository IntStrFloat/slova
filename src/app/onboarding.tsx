import { Redirect } from 'expo-router';

/** Legacy deep links land on the first playable field. */
export default function Onboarding() {
  return <Redirect href="/game" />;
}
