import TestRenderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';

import { AppButton, AppText } from '@/ui';
import { storage } from '@/core/storage';
import { useProfile } from '@/features/profile';
import { WordReportModal, type WordReportContext } from '../index';

const context: WordReportContext = {
  globalLevel: 6,
  world: 'world1',
  mode: 'normal',
  contentVersion: 'dict-v3',
  levelFingerprint: 'a'.repeat(64),
  policyRevision: null,
};

test('word report preview shows the typed word and level before an explicit send', async () => {
  storage.clearAll();
  const originalFetch = globalThis.fetch;
  const fetchMock = jest.fn().mockResolvedValue({ status: 201, json: async () => ({ duplicate: false }) });
  globalThis.fetch = fetchMock;
  useProfile.setState({ profile: {
    userId: 'user-1', authToken: 'test-token', nickname: 'Игрок', tag: '1234',
  } });
  try {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <WordReportModal visible context={context} initialWord="море" onClose={() => {}} />,
      );
    });
    const labels = tree.root.findAllByType(AppText).map((item) => item.props.children);
    expect(labels.some((value) => typeof value === 'string' && value.includes('Сообщить о слове'))).toBe(true);
    expect(labels.some((value) => Array.isArray(value) && value.join('').includes('уровень 6'))).toBe(true);
    expect(tree.root.findByType(TextInput).props.value).toBe('море');
    expect(fetchMock).not.toHaveBeenCalled();

    const send = tree.root.findAllByType(AppButton).find((button) => button.props.label === 'Отправить сообщение');
    expect(send?.props.disabled).toBe(false);
    await act(async () => { send?.props.onPress(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('storage failure keeps the typed draft visible and offers a truthful retry', async () => {
  storage.clearAll();
  const originalFetch = globalThis.fetch;
  const fetchMock = jest.fn().mockResolvedValue({ status: 201, json: async () => ({ duplicate: false }) });
  globalThis.fetch = fetchMock;
  const write = jest.spyOn(storage, 'set').mockImplementationOnce(() => { throw new Error('disk full'); });
  try {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <WordReportModal visible context={context} initialWord="море" onClose={() => {}} />,
      );
    });
    const send = () => tree.root.findAllByType(AppButton)
      .find((button) => button.props.label === 'Отправить сообщение')!.props.onPress();
    await act(async () => { send(); });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(tree.root.findByType(TextInput).props.value).toBe('море');
    expect(tree.root.findAllByType(AppText).some((item) =>
      typeof item.props.children === 'string' && item.props.children.includes('Не удалось сохранить сообщение'))).toBe(true);

    write.mockRestore();
    await act(async () => { send(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  } finally {
    write.mockRestore();
    globalThis.fetch = originalFetch;
  }
});
