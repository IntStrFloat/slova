import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Modal, Pressable, ScrollView, SectionList, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { allLandmarks, WORLDS } from '@/core/config/worlds';
import { useGoBack } from '@/core/nav';
import { getString, setString } from '@/core/storage';
import { track, trackOnce } from '@/features/analytics';
import { trackObservedRetentionMilestones } from '@/features/analytics/retentionEvents';
import { albumThumbnail } from '@/features/collection/albumThumbnails';
import { useCollection } from '@/features/collection';
import { useDailyPuzzle } from '@/features/dailypuzzle';
import { useLevels } from '@/features/levels';
import { getCollectibles, getDailyCollectionStatus, getFeatureGates, getJourneyStatus, useRetention, type CollectibleView } from '@/features/retention';
import { ruCount } from '@/features/retention-ui/text';
import { useViewportExposure } from '@/features/retention-ui/viewportExposure';
import { AppButton, AppText, colors, Icon, radius, WorldBackground } from '@/ui';

const FACTS = new Map(allLandmarks().map((landmark) => [landmark.id, landmark.fact]));
const ALBUM_HELP_KEY = 'album.help.seen.v1';

interface RouteCard extends CollectibleView {
  routeWorld: string;
  routeWorldTitle: string;
  untilLevel: number;
}

function isRouteCard(card: CollectibleView): card is RouteCard {
  return 'routeWorld' in card;
}

function sourceText(card: CollectibleView): string {
  if (isRouteCard(card)) return `Карточка фона · ${card.routeWorldTitle} · уровень ${card.untilLevel}`;
  if (card.kind === 'journey') return 'Наградная открытка путешествия';
  if (card.kind === 'daily') return 'Кроссворд дня';
  if (card.kind === 'weekly') return 'Личная неделя';
  if (card.kind === 'event') return 'Событие «Собери чемодан»';
  return card.id.startsWith('event') ? 'Событие «Собери чемодан»' : 'Оформление альбома';
}

function unlockText(card: CollectibleView): string {
  if (isRouteCard(card)) return `Откроется после уровня ${card.untilLevel}`;
  if (card.kind === 'journey') return `Откроется после ${card.threshold} завершённых уровней маршрута`;
  if (card.kind === 'daily') return `Откроется после ${card.threshold} разных кроссвордов дня`;
  if (card.kind === 'weekly') return 'Откроется за 5 активных дней личной недели';
  if (card.kind === 'event') return 'Откроется за 15 очков активного события';
  return card.id.startsWith('event') ? 'Откроется за 25 очков события' : 'Откроется вместе с шестой открыткой альбома';
}

function Postcard({ card, onOpen, selectedCoverId }: { card: CollectibleView; onOpen: (card: CollectibleView) => void; selectedCoverId: string | null }) {
  return (
    <Pressable disabled={!card.owned} onPress={() => onOpen(card)} accessibilityRole={card.owned ? 'button' : undefined}
      accessibilityLabel={`${card.title}. ${card.owned ? 'Открыть открытку' : unlockText(card)}`}
      style={({ pressed }) => [styles.card, pressed && card.owned && styles.cardPressed, card.owned && !card.seen && styles.cardNew]}>
      <View style={[styles.cardImageWrap, !card.owned && styles.cardLocked]}>
        {(card.owned || isRouteCard(card)) && card.image ? <Image source={albumThumbnail(card.artId) ?? card.image} contentFit="cover" decodeFormat="rgb" priority={card.owned ? 'normal' : 'low'} recyclingKey={card.id} style={StyleSheet.absoluteFill} accessibilityLabel={card.owned ? card.title : undefined} /> :
          card.owned ? <Icon name="collection" size={34} color={colors.brown} /> :
            <View style={styles.lockedMark}><AppText preset="display" style={styles.questionMark}>?</AppText><Icon name="lock" size={19} color={colors.brown} /></View>}
        {!card.owned && isRouteCard(card) ? <View style={styles.routeImageVeil}><Icon name="lock" size={23} color={colors.cream} /></View> : null}
        {card.owned && (card.id === selectedCoverId || !card.seen) ? <View style={styles.cardBadge}>
          <AppText preset="label" style={styles.cardBadgeText}>{card.id === selectedCoverId ? 'Выбрано' : 'Новая'}</AppText>
        </View> : null}
      </View>
      <View style={styles.cardInfo}>
        <AppText preset="label" style={styles.cardTitle} numberOfLines={2}>{card.title}</AppText>
        <AppText preset="body" style={styles.cardSource} numberOfLines={2}>{isRouteCard(card) ? `Уровень ${card.untilLevel}` : sourceText(card)}</AppText>
        {!card.owned ? <AppText preset="body" style={styles.cardHint}>{unlockText(card)}</AppText> : null}
      </View>
    </Pressable>
  );
}

function cardRows(cards: CollectibleView[]): CollectibleView[][] {
  const rows: CollectibleView[][] = [];
  for (let index = 0; index < cards.length; index += 2) rows.push(cards.slice(index, index + 2));
  return rows;
}

export default function Collection() {
  const goBack = useGoBack();
  const { width, height, fontScale } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const largeTextCompact = height < 700 && fontScale >= 1.2;
  const pictureHeight = Math.min(height * (largeTextCompact ? 0.24 : height < 700 ? 0.32 : 0.4), 320);
  const pictureWidth = Math.min(width - 90, pictureHeight * 0.75);
  const openedLandmarks = useCollection((state) => state.opened);
  const currentLevel = useLevels((state) => state.currentLevel);
  const selectedCoverId = useCollection((state) => state.selectedCoverId);
  const selectCover = useCollection((state) => state.selectCover);
  const retention = useRetention();
  const gates = getFeatureGates(retention);
  const daily = useDailyPuzzle();
  const journey = getJourneyStatus(retention);
  const dailyProgress = getDailyCollectionStatus(retention);
  const allCards = getCollectibles(retention);
  const ownedCovers = allCards.filter((card) => card.kind === 'cover' && card.owned);
  const selectedCoverTitle = ownedCovers.find((card) => card.id === selectedCoverId)?.title;
  const [selected, setSelected] = useState<CollectibleView | null>(null);
  const [showHelp, setShowHelp] = useState(() => getString(ALBUM_HELP_KEY) !== 'seen');
  const exposure = useViewportExposure((id) => {
    if (id === 'album_help') {
      setString(ALBUM_HELP_KEY, 'seen');
      trackOnce('album_help_seen', 'first_visit', { screen: 'collection' });
    }
  }, showHelp ? ['album_help'] : []);
  const detailWorld = selected && isRouteCard(selected) ? selected.routeWorld
    : allLandmarks().find((landmark) => landmark.id === selected?.artId)?.world ?? 'world1';
  const openedSet = new Set(openedLandmarks);
  const routeSections = WORLDS.filter((world) => world.startsAt <= currentLevel).map((world) => {
    const completedWorld = currentLevel > world.endsAt;
    const cards: RouteCard[] = world.landmarks
      .filter((landmark) => !completedWorld || openedSet.has(landmark.id))
      .map((landmark) => ({
        id: `route:${landmark.id}`, kind: 'journey', title: landmark.title,
        artId: landmark.id, image: landmark.image, owned: openedSet.has(landmark.id),
        seen: true, threshold: landmark.untilLevel,
        untilLevel: landmark.untilLevel, routeWorld: world.id, routeWorldTitle: world.title,
      }));
    return {
      title: `Карточки фона · ${world.title}`,
      subtitle: completedWorld ? `Открыто ${ruCount(cards.length, 'место', 'места', 'мест')}`
        : 'Новые виды открываются по мере прохождения уровней',
      data: cards,
    };
  }).filter((section) => section.data.length > 0);
  const routeOwnedCount = allLandmarks().filter((landmark) => openedSet.has(landmark.id)).length;
  const ownedCount = allCards.filter((card) => card.owned && card.kind !== 'cover').length + routeOwnedCount;

  useFocusEffect(useCallback(() => {
    exposure.focus();
    track('album_opened', { screen: 'collection' });
    track('collection_opened', { screen: 'collection' });
    trackObservedRetentionMilestones(useRetention.getState());
    return exposure.blur;
  }, [exposure]));

  const journeyCards = allCards.filter((card) => card.kind === 'journey');
  const nextJourneyIndex = journeyCards.findIndex((card) => !card.owned);
  const journeyAlbum = Math.floor(Math.max(0, nextJourneyIndex) / 6);
  const visibleJourney = journeyCards.filter((card, index) => card.owned || Math.floor(index / 6) === journeyAlbum);
  const dailyCards = allCards.filter((card) => card.kind === 'daily');
  const nextDailyIndex = dailyCards.findIndex((card) => !card.owned);
  const dailyVolume = Math.floor(Math.max(0, nextDailyIndex) / 4);
  const visibleDaily = dailyCards.filter((card, index) => card.owned || Math.floor(index / 4) === dailyVolume);
  const allWeeklyCards = allCards.filter((card) => card.kind === 'weekly');
  const nextWeeklyIndex = allWeeklyCards.findIndex((card) => !card.owned);
  const weeklyCards = allWeeklyCards.filter((card, index) => card.owned || index === nextWeeklyIndex);
  const eventCards = allCards.filter((card) => card.kind === 'event' || (card.kind === 'cover' && card.id.startsWith('event'))).filter((card) => card.owned);
  const covers = allCards.filter((card) => card.kind === 'cover' && !card.id.startsWith('event') && card.owned);
  const sections = [
    ...routeSections,
    { title: 'Наградные открытки', subtitle: journey.nextPostcardAt === null ? 'Все доступные открытки собраны' : `До следующей наградной открытки — ${journey.remaining} ур.`, data: visibleJourney },
    { title: 'Дневник дня', subtitle: dailyProgress.nextPostcardAt === null ? 'Все доступные открытки собраны' : `${daily.tomeProgress().inVolume} из 22 в текущем томе · до открытки ${ruCount(dailyProgress.remaining ?? 0, 'решение', 'решения', 'решений')}`, data: gates.daily || visibleDaily.some((card) => card.owned) ? visibleDaily : [] },
    { title: 'Личные недели', subtitle: 'Открытка за любые 5 активных дней из 7', data: gates.week || weeklyCards.some((card) => card.owned) ? weeklyCards : [] },
    { title: 'События', subtitle: 'Полученные открытки сохраняются после события', data: eventCards },
    { title: 'Обложки', subtitle: 'Оформление за завершённый альбом', data: covers },
  ].filter((section) => section.data.length > 0).map((section) => ({ ...section, data: cardRows(section.data) }));

  const openCard = (card: CollectibleView) => {
    if (!card.owned) return;
    if (isRouteCard(card)) {
      track('route_card_opened', { landmarkId: card.artId, world: card.routeWorld });
    } else {
      useRetention.getState().markCollectibleSeen(card.id);
      track('collectible_opened', { collectibleId: card.id, kind: card.kind });
      trackOnce('reward_presentation_seen', card.id, { rewardId: card.id, screen: 'collection' });
    }
    setSelected(card);
  };

  const chooseCover = (id: string | null) => {
    if (selectCover(id)) {
      track('cover_selected', id ? { collectibleId: id } : { mode: 'default' });
      setSelected(null);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world="world1" />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.toolbar}>
          <AppButton label="Назад" variant="glass" icon="back" onPress={goBack} style={{ paddingHorizontal: 14 }} />
          <View style={styles.countPill}><Icon name="collection" size={16} color={colors.goldBorder} /><AppText preset="label" style={styles.countText}>{ownedCount} открыто</AppText></View>
        </View>
        <SectionList
          {...exposure.scrollProps}
          sections={sections}
          keyExtractor={(row) => row.map((card) => card.id).join('|')}
          initialNumToRender={3}
          maxToRenderPerBatch={3}
          windowSize={5}
          contentInsetAdjustmentBehavior="automatic"
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={<View>
            <View style={[styles.albumHero, height < 700 && styles.albumHeroCompact]}>
              <AppText preset="label" style={styles.heroEyebrow}>ВАШИ ПУТЕШЕСТВИЯ</AppText>
              <AppText preset="display" style={[styles.heroTitle, width < 350 && styles.heroTitleNarrow]}>Альбом открыток</AppText>
              <AppText preset="body" style={styles.heroDescription}>Места, которые вы открыли, останутся с вами.</AppText>
            </View>
            {showHelp ? <View onLayout={exposure.cardLayout('album_help')} style={{ marginHorizontal: 16, marginBottom: 16, padding: 14, borderRadius: radius.md, backgroundColor: colors.cream, gap: 7 }}>
              <AppText preset="label" style={{ color: colors.brown, fontSize: 15 }}>Как собирать открытки</AppText>
              <AppText preset="body" style={{ color: colors.brown, fontSize: 13 }}>Проходите уровни и кроссворды дня. Под закрытой открыткой указано, сколько решений осталось. Полученные открытки можно открыть и рассмотреть.</AppText>
              <Pressable accessibilityRole="button" accessibilityLabel="Понятно про альбом" style={{ minHeight: 48, justifyContent: 'center' }} onPress={() => { setString(ALBUM_HELP_KEY, 'seen'); setShowHelp(false); }}>
                <AppText preset="label" style={{ color: colors.playGreenDark }}>Понятно</AppText>
              </Pressable>
            </View> : null}
          </View>}
          renderSectionHeader={({ section }) => <View style={styles.sectionHeader}>
            <View style={styles.sectionHeadingRow}>
              <View style={styles.sectionRule} />
              <AppText preset="title" style={[styles.sectionTitle, width < 350 && styles.sectionTitleNarrow]}>{section.title}</AppText>
            </View>
            <AppText preset="body" style={styles.sectionSubtitle}>{section.subtitle}</AppText>
          </View>}
          renderItem={({ item }) => <View style={styles.cardRow}>{item.map((card) => <Postcard key={card.id} card={card} onOpen={openCard} selectedCoverId={selectedCoverId} />)}{item.length === 1 ? <View style={{ flex: 1 }} /> : null}</View>}
          renderSectionFooter={() => <View style={styles.sectionFooter} />}
          ListFooterComponent={ownedCovers.length > 0 ? <View style={styles.coverControl}>
            <AppText preset="label" style={styles.coverTitle}>Фон путешествия</AppText>
            <AppText preset="body" style={styles.coverDescription}>{selectedCoverTitle ? `Сейчас выбрано: ${selectedCoverTitle}` : 'Сейчас выбран обычный фон маршрута.'}</AppText>
            {selectedCoverId ? <Pressable onPress={() => chooseCover(null)} accessibilityRole="button" accessibilityLabel="Вернуть обычный фон" style={styles.resetCover}><AppText preset="label" style={styles.resetCoverText}>Вернуть обычный фон</AppText></Pressable> : null}
          </View> : <View style={styles.listFoot} />}
        />
      </SafeAreaView>
      <Modal visible={selected !== null} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <SafeAreaView style={styles.modalSafe}>
          {selected ? <WorldBackground world={detailWorld} dim /> : null}
          <ScrollView contentContainerStyle={[styles.modalContent, height < 700 && styles.modalContentCompact]} showsVerticalScrollIndicator={false}>
            {selected ? <>
              <View style={styles.modalTop}>
                <Pressable onPress={() => setSelected(null)} accessibilityRole="button" accessibilityLabel="Закрыть открытку" style={styles.modalClose}><Icon name="back" size={22} color={colors.text} /></Pressable>
              </View>
              <View style={styles.modalHeading}>
                <AppText preset="display" accessibilityLabel={largeTextCompact ? `${selected.title}. ${sourceText(selected)}` : undefined} style={[styles.modalTitle, width < 350 && styles.modalTitleNarrow]}>{selected.title}</AppText>
                {!largeTextCompact ? <AppText preset="label" style={styles.modalSource}>{sourceText(selected)}</AppText> : null}
              </View>
              <Animated.View entering={reducedMotion ? FadeIn.duration(120) : FadeInDown.duration(260)} style={styles.modalPictureWrap}>
                {selected.image ? <Image source={selected.image} contentFit="cover" style={[styles.modalPicture, { width: pictureWidth, height: pictureHeight }]} accessibilityLabel={selected.title} /> :
                  <View style={styles.modalMissing}><AppText preset="body" style={{ textAlign: 'center' }}>Изображение загрузится при подключении</AppText></View>}
              </Animated.View>
              <View style={styles.modalBottom}>
                <View style={styles.modalFactPanel}>
                  <AppText preset="body" style={styles.modalFact}>{selected.kind === 'cover' ? 'Оформление меняет фон приложения. Игровое поле остаётся затемнённым для читаемости.' : FACTS.get(selected.artId) ?? 'Эта открытка уже в вашей коллекции.'}</AppText>
                </View>
              </View>
            </> : null}
          </ScrollView>
          {selected ? <View style={styles.modalActionDock}>
            {selected.kind === 'cover' ? selected.id === selectedCoverId ?
              <AppText preset="label" style={styles.selectedCoverText}>Это оформление выбрано</AppText> :
              <AppButton label="Выбрать фон" icon="check" onPress={() => chooseCover(selected.id)} style={styles.modalAction} /> : null}
            <AppButton label="К альбому" icon="back" variant="glass" onPress={() => setSelected(null)} style={styles.modalAction} />
          </View> : null}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { minHeight: 58, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  countPill: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: 'rgba(25,18,30,0.76)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.32)' },
  countText: { color: colors.cream, fontSize: 10 },
  listContent: { paddingBottom: 0 },
  albumHero: { minHeight: 190, justifyContent: 'flex-end', gap: 8, paddingHorizontal: 20, paddingBottom: 28 },
  albumHeroCompact: { minHeight: 138, paddingBottom: 20 },
  heroEyebrow: { color: colors.cream, fontSize: 11, letterSpacing: 1.6 },
  heroTitle: { color: colors.text, fontSize: 27, lineHeight: 35 },
  heroTitleNarrow: { fontSize: 24, lineHeight: 31 },
  heroDescription: { color: colors.cream, fontSize: 13, lineHeight: 19, maxWidth: 310 },
  sectionHeader: { backgroundColor: colors.cream, borderTopWidth: 3, borderTopColor: colors.goldBorder, paddingHorizontal: 18, paddingTop: 20, paddingBottom: 13, gap: 7 },
  sectionHeadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionRule: { width: 5, height: 23, borderRadius: radius.pill, backgroundColor: colors.playGreen },
  sectionTitle: { color: colors.brown, fontSize: 19, lineHeight: 25, flexShrink: 1 },
  sectionTitleNarrow: { fontSize: 17, lineHeight: 23 },
  sectionSubtitle: { color: colors.brown, opacity: 0.74, fontSize: 12, lineHeight: 18 },
  sectionFooter: { height: 16, backgroundColor: colors.cream },
  cardRow: { flexDirection: 'row', alignItems: 'stretch', gap: 12, paddingHorizontal: 16, marginTop: -1, backgroundColor: colors.cream },
  card: { flex: 1, marginBottom: 12, minWidth: 0, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: '#FFFCF2', borderWidth: 1, borderColor: colors.goldBorder, boxShadow: '0 5px 12px rgba(55,37,29,0.12)' },
  cardPressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
  cardNew: { borderWidth: 2, borderColor: colors.playGreen },
  cardImageWrap: { height: 160, backgroundColor: colors.creamDeep, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  cardLocked: { backgroundColor: '#E9DEB4' },
  routeImageVeil: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(35,20,43,0.69)', alignItems: 'center', justifyContent: 'center' },
  lockedMark: { alignItems: 'center', gap: 4 },
  questionMark: { color: 'rgba(91,73,54,0.44)', fontSize: 58, lineHeight: 68 },
  cardBadge: { position: 'absolute', right: 6, top: 6, borderRadius: radius.pill, backgroundColor: colors.playGreenDark, borderWidth: 1, borderColor: colors.playGreen, paddingHorizontal: 8, paddingVertical: 5 },
  cardBadgeText: { color: colors.onGreen, fontSize: 11 },
  cardInfo: { gap: 5, paddingHorizontal: 9, paddingVertical: 10 },
  cardTitle: { color: colors.brown, fontSize: 13, lineHeight: 18 },
  cardSource: { color: colors.brown, opacity: 0.72, fontSize: 11, lineHeight: 15 },
  cardHint: { color: colors.brown, opacity: 0.67, fontSize: 11, lineHeight: 15 },
  coverControl: { backgroundColor: colors.cream, borderTopWidth: 1, borderColor: colors.goldBorder, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 36, gap: 7 },
  coverTitle: { color: colors.brown, fontSize: 15 },
  coverDescription: { color: colors.brown, fontSize: 12, lineHeight: 18 },
  resetCover: { minHeight: 48, justifyContent: 'center' },
  resetCoverText: { color: colors.playGreenDark, fontSize: 12 },
  listFoot: { height: 25, backgroundColor: colors.cream },
  modalSafe: { flex: 1, backgroundColor: colors.plumDeep },
  modalContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'space-between', gap: 18, paddingHorizontal: 18, paddingBottom: 24 },
  modalContentCompact: { gap: 12, paddingBottom: 14 },
  modalTop: { alignSelf: 'stretch', minHeight: 50, justifyContent: 'center' },
  modalClose: { width: 48, height: 48, borderRadius: radius.pill, backgroundColor: 'rgba(21,14,28,0.66)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center' },
  modalHeading: { alignItems: 'center', gap: 8, maxWidth: 400 },
  modalTitle: { color: colors.text, textAlign: 'center', fontSize: 25, lineHeight: 34 },
  modalTitleNarrow: { fontSize: 22, lineHeight: 30 },
  modalSource: { color: colors.cream, textAlign: 'center', fontSize: 12 },
  modalPictureWrap: { alignItems: 'center' },
  modalPicture: { borderRadius: radius.sm, borderWidth: 3, borderColor: colors.cream, boxShadow: '0 12px 30px rgba(3,7,12,0.55)' },
  modalMissing: { minHeight: 180, width: 220, padding: 18, borderRadius: radius.sm, backgroundColor: colors.glassStrong, alignItems: 'center', justifyContent: 'center' },
  modalBottom: { alignSelf: 'stretch', maxWidth: 440, gap: 10, alignItems: 'center' },
  modalFactPanel: { alignSelf: 'stretch', paddingHorizontal: 11, paddingVertical: 9, borderRadius: radius.md, backgroundColor: 'rgba(35,20,43,0.64)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.17)' },
  modalFact: { color: colors.text, textAlign: 'center', fontSize: 13, lineHeight: 21 },
  modalActionDock: { alignSelf: 'stretch', gap: 8, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 10, backgroundColor: 'rgba(35,20,43,0.34)' },
  selectedCoverText: { color: colors.cream, textAlign: 'center', fontSize: 12 },
  modalAction: { alignSelf: 'stretch', paddingHorizontal: 12 },
});
