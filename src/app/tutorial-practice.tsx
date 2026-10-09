import { useGoBack } from '@/core/nav';
import { PracticeLesson } from '@/features/onboarding/PracticeLesson';

export default function TutorialPracticeScreen() {
  const goBack = useGoBack();
  return <PracticeLesson onDone={goBack} />;
}
