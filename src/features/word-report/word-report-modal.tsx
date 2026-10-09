import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { normalizeSubmission } from '@/core/engine';
import { AppButton, AppText, colors, GlassPanel, radius } from '@/ui';
import {
  canReportWord,
  sendWordReport,
  type WordClassification,
  type WordReportContext,
  type WordReportKind,
  type WordReportResult,
} from './client';

export type WordReportModalProps = {
  visible: boolean;
  context: WordReportContext;
  initialWord?: string;
  currentClassification?: WordClassification;
  onClose: () => void;
  onSubmitted?: (reportId: string) => void;
};

const kindOptions: { value: WordReportKind; label: string }[] = [
  { value: 'missing_valid', label: 'Слово должно приниматься' },
  { value: 'inappropriate_or_wrong', label: 'Слово ошибочное или неуместное' },
];

function resultMessage(result: WordReportResult): string {
  switch (result.status) {
    case 'sent': return 'Спасибо! Сообщение отправлено на проверку.';
    case 'duplicate': return 'Вы уже сообщили об этом слове.';
    case 'queued': return 'Нет связи. Сообщение сохранено на устройстве и отправится при следующей попытке.';
    case 'auth_required': return 'Сообщение сохранено. Оно отправится после восстановления профиля.';
    case 'rate_limited': return 'Лимит сообщений достигнут. Попробуйте позже.';
    case 'unsupported_content': return 'Для этой версии уровня отправка пока недоступна.';
    case 'unavailable': return 'Приём сообщений временно недоступен.';
    case 'invalid': return 'Не удалось отправить. Проверьте слово и попробуйте ещё раз.';
    case 'save_failed': return 'Не удалось сохранить сообщение. Слово осталось в форме — попробуйте ещё раз.';
  }
}

function WordReportForm({
  context,
  initialWord = '',
  currentClassification = 'invalid',
  onClose,
  onSubmitted,
}: Omit<WordReportModalProps, 'visible'>) {
  const [word, setWord] = useState(initialWord);
  const [kind, setKind] = useState<WordReportKind>('missing_valid');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<WordReportResult | null>(null);

  const validWord = normalizeSubmission(word.trim()).ok;
  const supported = canReportWord(context);

  const submit = async () => {
    if (busy || !validWord || !supported) return;
    setBusy(true);
    try {
      const outcome = await sendWordReport({
        word,
        reportKind: kind,
        currentClassification,
        context,
      });
      setResult(outcome);
      if ((outcome.status === 'sent' || outcome.status === 'duplicate') && outcome.reportId) {
        onSubmitted?.(outcome.reportId);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.scrim }}>
        <KeyboardAvoidingView behavior="height" style={{ flex: 1 }}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20 }}
          >
            <Pressable onPress={onClose} style={{ flex: 1, justifyContent: 'center' }}>
              <Pressable onPress={(event) => event.stopPropagation()}>
                <GlassPanel strong style={{ alignSelf: 'center', width: '100%', maxWidth: 440, gap: 14, padding: 22 }}>
                  <AppText preset="title" style={{ textAlign: 'center' }}>Сообщить о слове</AppText>
                  <AppText preset="body" style={{ color: colors.textMuted, textAlign: 'center' }}>
                    Сообщение не прерывает уровень. Проверка словаря займёт время.
                  </AppText>

                  <View style={{ gap: 6 }}>
                    <AppText preset="label">Слово</AppText>
                    <TextInput
                      value={word}
                      onChangeText={(value) => { setWord(value); setResult(null); }}
                      maxLength={24}
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder="Введите слово"
                      placeholderTextColor={colors.textMuted}
                      accessibilityLabel="Слово для проверки"
                      style={{
                        color: colors.text,
                        backgroundColor: colors.glass,
                        borderColor: colors.glassBorder,
                        borderWidth: 1,
                        borderRadius: radius.sm,
                        paddingHorizontal: 16,
                        minHeight: 54,
                        fontSize: 18,
                      }}
                    />
                    <AppText preset="body" style={{ color: colors.textMuted }}>
                      От 3 до 8 русских букв. Ё считается как Е.
                    </AppText>
                  </View>

                  <View style={{ gap: 8 }}>
                    <AppText preset="label">Что не так?</AppText>
                    {kindOptions.map((option) => (
                      <Pressable
                        key={option.value}
                        onPress={() => { setKind(option.value); setResult(null); }}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: kind === option.value }}
                        style={{
                          minHeight: 48,
                          justifyContent: 'center',
                          paddingHorizontal: 14,
                          borderWidth: 1,
                          borderColor: kind === option.value ? colors.amber : colors.glassBorder,
                          backgroundColor: kind === option.value ? colors.offline : colors.glass,
                          borderRadius: radius.sm,
                        }}
                      >
                        <AppText preset="body">{option.label}</AppText>
                      </Pressable>
                    ))}
                  </View>

                  <AppText preset="body" selectable style={{ color: colors.textMuted }}>
                    Перед отправкой: «{word.trim() || '…'}» · уровень {context.globalLevel} · {context.mode === 'daily' ? 'ежедневный' : 'основной'} кроссворд
                  </AppText>

                  {!supported ? (
                    <AppText preset="body" style={{ color: colors.amber }}>
                      Для этой версии уровня отправка пока недоступна.
                    </AppText>
                  ) : null}
                  {result ? (
                    <AppText
                      preset="body"
                      accessibilityRole="alert"
                      style={{ color: result.status === 'sent' || result.status === 'duplicate' ? colors.success : colors.amber }}
                    >
                      {resultMessage(result)}
                    </AppText>
                  ) : null}

                  <View style={{ gap: 10 }}>
                    <AppButton
                      label={busy ? 'Отправка…' : 'Отправить сообщение'}
                      onPress={() => { void submit(); }}
                      disabled={busy || !validWord || !supported || result?.status === 'sent' || result?.status === 'duplicate'}
                    />
                    <AppButton label="Вернуться к игре" variant="glass" onPress={onClose} />
                  </View>
                </GlassPanel>
              </Pressable>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Explicit, in-game review before a disputed word is sent to moderation. */
export function WordReportModal({ visible, ...props }: WordReportModalProps) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={props.onClose} statusBarTranslucent>
      {visible ? <WordReportForm {...props} /> : null}
    </Modal>
  );
}
