// Aetherium Guild Codex: complete Behavior Pack example powered by bedrock-baked-ui/runtime.

import { world, type Player } from '@minecraft/server';
import { BakedMenuManager, fitText } from 'bedrock-baked-ui/runtime';
import manifest from './generated/baked_site.json';

interface GuildProfile {
  gold: number;
  gems: number;
  heroClass: 'knight' | 'arcanist' | 'ranger' | 'cleric';
  selectedRelic: number;
  ownedRelics: Set<number>;
  selectedQuest: number;
  activeQuest: number | null;
  sfx: boolean;
  aura: boolean;
  titleIdx: number;
  dailyClaimed: boolean;
}

const TITLES = [
  { en: 'Mythic III', ko: '신화 III' },
  { en: 'Citadel Warden', ko: '성채 수호자' },
  { en: 'Astral Sage', ko: '성좌 현자' },
] as const;

const CLASSES: Record<GuildProfile['heroClass'], { en: string; ko: string; stats: string }> = {
  knight: { en: 'Vanguard Knight', ko: '선봉 기사', stats: 'HP 26 · ATK 8' },
  arcanist: { en: 'Astral Arcanist', ko: '비전 마도사', stats: 'HP 18 · MAG 12' },
  ranger: { en: 'Windwalker', ko: '바람 궁수', stats: 'HP 20 · SPD +20%' },
  cleric: { en: 'Dawncleric', ko: '여명 사제', stats: 'HP 22 · HEAL +6' },
};

const RELICS = [
  { en: 'Dragonfang Blade', ko: '용아 대검', gold: 420, gems: 0, perkEn: 'Ignites targets on crit strikes.', perkKo: '치명타 적중 시 화염 점화.' },
  { en: 'Aegis of Dawn', ko: '여명의 이지스', gold: 310, gems: 0, perkEn: 'Absorbs 35% projectile impact.', perkKo: '투사체 피해 35% 경감.' },
  { en: 'Zephyr Striders', ko: '서풍의 장화', gold: 240, gems: 0, perkEn: 'Grants Swiftness II in sprints.', perkKo: '질주 시 신속 II 부여.' },
  { en: 'Chrono Hourglass', ko: '시간의 모래시계', gold: 0, gems: 6, perkEn: 'Cuts skill cooldowns by 25%.', perkKo: '스킬 재사용 대기 25% 단축.' },
  { en: 'Phoenix Elixir', ko: '불사조 영약', gold: 160, gems: 0, perkEn: 'Instant +10 HP & Fire Resist.', perkKo: '즉시 체력 +10 및 화염 저항.' },
  { en: 'Starlight Lantern', ko: '별빛 등불', gold: 0, gems: 4, perkEn: 'Reveals hidden dungeon chests.', perkKo: '숨겨진 던전 보물 상자 탐지.' },
] as const;

const QUESTS = [
  { en: 'Slay the Crimson Wyrm (S-Rank)', ko: '진홍빛 와이번 토벌 (S등급)', reward: '+600 G · +3 Gems' },
  { en: 'Hold the Northern Bastion (A-Rank)', ko: '북부 성채 방어전 (A등급)', reward: '+380 G · +2 Gems' },
  { en: 'Recover Astral Shards (B-Rank)', ko: '별빛 파편 회수 (B등급)', reward: '+220 G · +1 Gem' },
] as const;

const profiles = new Map<string, GuildProfile>();

function profileOf(name: string): GuildProfile {
  let p = profiles.get(name);
  if (!p) {
    p = {
      gold: 2450,
      gems: 18,
      heroClass: 'knight',
      selectedRelic: 0,
      ownedRelics: new Set(),
      selectedQuest: 0,
      activeQuest: null,
      sfx: true,
      aura: true,
      titleIdx: 0,
      dailyClaimed: false,
    };
    profiles.set(name, p);
  }
  return p;
}

function playUiSound(player: Player, profile: GuildProfile, soundId: string, pitch = 1.0): void {
  if (!profile.sfx) return;
  try {
    player.playSound(soundId, { volume: 0.55, pitch });
  } catch {}
}

export const codexMenu = new BakedMenuManager(manifest, {
  triggerItemId: 'minecraft:compass',

  resolveDynamicValues(player, state) {
    const p = profileOf(player.name);
    const ko = state.bakedKey.startsWith('ko_');
    const tab = state.bakedKey.slice(3);
    const cls = CLASSES[p.heroClass];
    const title = TITLES[p.titleIdx % TITLES.length];

    let line1 = '';
    let line2 = '';

    if (tab === 'shop') {
      const relic = RELICS[p.selectedRelic] ?? RELICS[0];
      const owned = p.ownedRelics.has(p.selectedRelic);
      const priceStr = relic.gold > 0 ? `${relic.gold} G` : `${relic.gems} Gems`;
      const afford = p.gold >= relic.gold && p.gems >= relic.gems;
      line1 = ko
        ? `§6선택 유물: §f${relic.ko} §7(${priceStr}) ${owned ? '§a[보유중]' : afford ? '§a✓ 구매가능' : '§c✗ 재화부족'}`
        : `§6Selected: §f${relic.en} §7(${priceStr}) ${owned ? '§a[OWNED]' : afford ? '§a✓ Ready' : '§c✗ Insufficient'}`;
      line2 = ko ? `§7효과: §f${relic.perkKo}` : `§7Perk: §f${relic.perkEn}`;
    } else if (tab === 'quests') {
      const q = QUESTS[p.selectedQuest] ?? QUESTS[0];
      const tracked = p.activeQuest === p.selectedQuest;
      line1 = ko
        ? `§6선택 의뢰: §f${q.ko} ${tracked ? '§a[추적중]' : '§e[미수락]'}`
        : `§6Selected Quest: §f${q.en} ${tracked ? '§a[TRACKING]' : '§e[AVAILABLE]'}`;
      line2 = ko
        ? `§7보상: §e${q.reward} §7| 우측 상단 버튼으로 의뢰 수락`
        : `§7Reward: §e${q.reward} §7| Click ACCEPT & TRACK to begin`;
    } else if (tab === 'profile') {
      line1 = ko
        ? `§6길드원: §f${player.name} §7| 칭호: §b${title.ko} §7| 보유 유물: §e${p.ownedRelics.size}/6`
        : `§6Member: §f${player.name} §7| Title: §b${title.en} §7| Relics: §e${p.ownedRelics.size}/6`;
      line2 = ko
        ? `§7효과음: ${p.sfx ? '§aON' : '§cOFF'} §7| 성소 오라: ${p.aura ? '§dON' : '§cOFF'} §7| 클릭 수: §f${state.clicks}`
        : `§7UI SFX: ${p.sfx ? '§aON' : '§cOFF'} §7| Aura: ${p.aura ? '§dON' : '§cOFF'} §7| Clicks: §f${state.clicks}`;
    } else {
      line1 = ko
        ? `§6병과: §f${cls.ko} §7(${cls.stats}) | 칭호: §b${title.ko}`
        : `§6Class: §f${cls.en} §7(${cls.stats}) | Title: §b${title.en}`;
      line2 = ko
        ? `§7일일 공물: ${p.dailyClaimed ? '§a수령 완료' : '§e수령 가능 (+150 G)'} §7| 의뢰: ${p.activeQuest !== null ? '§b진행중' : '§7없음'}`
        : `§7Daily Tribute: ${p.dailyClaimed ? '§aClaimed' : '§eAvailable (+150 G)'} §7| Quest: ${p.activeQuest !== null ? '§bActive' : '§7None'}`;
    }

    return {
      gold: `§6§l${p.gold.toLocaleString('en-US')} G`,
      gems: `§b§l${p.gems} Gems`,
      status_primary: fitText(line1, 58),
      status_secondary: fitText(line2, 58),
    };
  },

  onButtonClick(player, button, state) {
    const p = profileOf(player.name);
    const ko = state.bakedKey.startsWith('ko_');
    const id = button.hitId;

    if (id.startsWith('act_class_')) {
      const cls = id.slice(10) as GuildProfile['heroClass'];
      if (cls in CLASSES) {
        p.heroClass = cls;
        playUiSound(player, p, 'random.orb', 1.25);
      }
      return;
    }

    if (id === 'act_deploy') {
      playUiSound(player, p, 'mob.enderdragon.growl', 1.1);
      player.sendMessage(ko ? '§a[길드] 흑요석 성채로 출격 준비가 완료되었습니다!' : '§a[Guild] Ready to deploy to the Obsidian Citadel!');
      codexMenu.close(player);
      return;
    }

    if (id === 'act_daily') {
      if (p.dailyClaimed) {
        playUiSound(player, p, 'note.bass', 0.7);
      } else {
        p.dailyClaimed = true;
        p.gold += 150;
        playUiSound(player, p, 'random.levelup', 1.3);
      }
      return;
    }

    if (id.startsWith('pick_')) {
      p.selectedRelic = Number(id.slice(5)) || 0;
      playUiSound(player, p, 'random.click', 1.1);
      return;
    }

    if (id === 'act_buy') {
      const relic = RELICS[p.selectedRelic];
      if (!relic || p.ownedRelics.has(p.selectedRelic) || p.gold < relic.gold || p.gems < relic.gems) {
        playUiSound(player, p, 'note.bass', 0.65);
        return;
      }
      p.gold -= relic.gold;
      p.gems -= relic.gems;
      p.ownedRelics.add(p.selectedRelic);
      playUiSound(player, p, 'random.anvil_use', 1.15);
      return;
    }

    if (id.startsWith('quest_')) {
      p.selectedQuest = Number(id.slice(6)) || 0;
      playUiSound(player, p, 'random.click', 1.05);
      return;
    }

    if (id === 'act_accept_quest') {
      p.activeQuest = p.selectedQuest;
      playUiSound(player, p, 'random.levelup', 1.15);
      return;
    }

    if (id === 'act_toggle_sfx') {
      p.sfx = !p.sfx;
      playUiSound(player, p, 'random.orb', 1.1);
      return;
    }

    if (id === 'act_toggle_aura') {
      p.aura = !p.aura;
      playUiSound(player, p, 'random.orb', 1.3);
      return;
    }

    if (id === 'act_cycle_title') {
      p.titleIdx = (p.titleIdx + 1) % TITLES.length;
      playUiSound(player, p, 'random.orb', 1.2);
      return;
    }

    if (id === 'act_reset_demo') {
      profiles.delete(player.name);
      playUiSound(player, profileOf(player.name), 'random.levelup', 0.9);
      return;
    }

    playUiSound(player, p, 'random.click', 1.0);
  },
});

codexMenu.install();

world.beforeEvents.chatSend.subscribe((ev) => {
  const msg = ev.message.trim().toLowerCase();
  if (msg === '!codex') {
    ev.cancel = true;
    codexMenu.open(ev.sender, 'en_home');
  } else if (msg === '!codex ko') {
    ev.cancel = true;
    codexMenu.open(ev.sender, 'ko_home');
  } else if (msg === '!codex form') {
    ev.cancel = true;
    void codexMenu.openActionFormFallback(ev.sender);
  }
});
