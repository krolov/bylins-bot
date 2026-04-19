# MUD Phrases Inventory

This document indexes every hardcoded MUD regex and phrase in the codebase. Purpose:
when a MUD response format changes or a new regex is added, a developer can find the
exact location and related patterns instantly. It also prevents silent regex drift
during extraction (see `.planning/research/PITFALLS.md` Pitfall 4) — any regex that
moves between files during Phase 2+ refactors must keep its entry here in sync.

**Maintenance rule:** whenever a regex is added, moved, or modified in source code,
the corresponding entry here MUST be updated in the same PR. The refactor-playbook
pre-flight checklist enforces this at review time.

**Duplication flag:** several ANSI-escape regexes exist in more than one file (exact
duplicates are called out inline). Consolidation is deferred to Phase 2+; the inventory
highlights the duplication so extraction PRs can plan the merge.

**Cyrillic example matches:** per Phase 1 Context D-16, example matches in this file
are Russian MUD text (that is the content being catalogued). Prose remains English.

## src/triggers.ts

### ansi-escape

```typescript
const ANSI_ESCAPE_REGEXP = /\u001b\[[0-9;]*m/g;
```

Purpose: strip ANSI color codes from MUD text before pattern matching. Short-form (no
`?`, no bracket set) — matches only color/style sequences. Duplicate regex families
appear in `src/server.ts`, `src/bazaar-notifier.ts`, `src/gather-script.ts`,
`src/zone-scripts/farm-zone-executor2.ts`.

### equipment-right

```typescript
const EQUIPMENT_RIGHT_REGEXP = /^<в правой руке>/m;
```

Purpose: detects the "right hand" slot line in an equipment listing.
Example match: `<в правой руке>     нож мастера-оружейника`

### equipment-left

```typescript
const EQUIPMENT_LEFT_REGEXP = /^<в левой руке>/m;
```

Purpose: detects the "left hand" slot line in an equipment listing.
Example match: `<в левой руке>     нож мастера-оружейника`

### disarm-both

```typescript
const DISARM_BOTH_REGEXP = /выбил .+ из ваших рук/;
```

Purpose: detects a both-hands disarm hit. Branches based on which hand was previously
armed via `EQUIPMENT_*` snapshot state.
Example match: `Лютый крыс выбил нож из ваших рук.`

### disarm-right

```typescript
const DISARM_RIGHT_REGEXP = /выбил .+ из вашей правой руки/;
```

Purpose: detects a right-hand-only disarm. Re-arm command `воор нож` follows.
Example match: `Лютый крыс выбил нож из вашей правой руки.`

### disarm-left

```typescript
const DISARM_LEFT_REGEXP = /выбил .+ из вашей левой руки/;
```

Purpose: detects a left-hand-only disarm. Re-arm command `держ нож` follows.
Example match: `Лютый крыс выбил нож из вашей левой руки.`

### memorizing

```typescript
const MEMORIZING_REGEXP = /Зауч:(\d+)(?::(\d+))?/;
```

Purpose: parses spell-memorization state from the prompt. Group 1 captures the major
counter (0 = idle), group 2 the sub-counter (undefined = fully idle).
Example match: `Зауч:0` (idle) or `Зауч:3:5` (in progress)

### assist-fighting

```typescript
const ASSIST_FIGHTING_REGEXP = /^(.+) сражается с (.+?)!?\s*$/;
```

Purpose: detects the "X is fighting Y" phrase used by the auto-assist trigger. Group 1
is attacker (checked against configured tank list), group 2 is the mob target.
Example match: `Бурз сражается с крысой!`

### assist-postcombat (regex array)

```typescript
const ASSIST_POSTCOMBAT_REGEXPS = [
  /^Кровушка стынет в жилах от предсмертного крика/,
  /^К вам вернулась способность двигаться\./,
  /^Вы вновь можете видеть\./,
  /^К вам вернулась способность видеть\./,
  /^Вы отступили из битвы\./,
];
```

Purpose: five separate regexes fired post-combat to trigger a `см` (look) refresh.
Example matches: the phrases above, emitted when the mob dies, when hold/blind expires,
or when the player voluntarily retreats.

### curse-hit

```typescript
const CURSE_HIT_REGEXP = /Красное сияние вспыхнуло/;
```

Purpose: confirms the curse spell landed on a mob (stops further curse casts this
battle).
Example match: `Красное сияние вспыхнуло вокруг крысы.`

### curse-memorizing

```typescript
const CURSE_MEMORIZING_REGEXP = /Вы занесли заклинание "[^"]*проклятие[^"]*" в свои резы/i;
```

Purpose: detects that a curse-spell charge was consumed and is now in memorization
queue.
Example match: `Вы занесли заклинание "проклятие" в свои резы.`

### light-dark

```typescript
const LIGHT_DARK_REGEXP = /^Слишком темно\.\.\./m;
```

Purpose: triggers light-cast when the room is too dark to see.
Example match: `Слишком темно...`

Duplication flag: a weaker `DARK_ROOM_REGEXP` variant exists in `src/map/parser.ts`
and `src/farm2/types.ts` (`/^Слишком темно\b/i`). Different anchoring on purpose —
parser wants word-boundary, triggers wants trailing ellipsis.

### light-fading

```typescript
const LIGHT_FADING_REGEXP = /Ваш светящийся шарик замерцал и начал угасать/;
```

Purpose: pre-emptive re-cast before the current light source goes out.
Example match: `Ваш светящийся шарик замерцал и начал угасать.`

### light-out

```typescript
const LIGHT_OUT_REGEXP = /Ваш светящийся шарик погас/;
```

Purpose: urgent re-cast — light source is out.
Example match: `Ваш светящийся шарик погас.`

### light-created

```typescript
const LIGHT_CREATED_REGEXP = /Вы создали светящийся шарик/;
```

Purpose: the new light source is in inventory; the controller now sends `зажечь шарик`.
Example match: `Вы создали светящийся шарик.`

### light-equipped

```typescript
const LIGHT_EQUIPPED_REGEXP = /^<для освещения>\s+светящийся шарик/m;
```

Purpose: detects that the light source is equipped in the illumination slot.
Example match: `<для освещения>     светящийся шарик`

### light-memorizing

```typescript
const LIGHT_MEMORIZING_REGEXP = /Вы занесли заклинание "[^"]*создать свет[^"]*" в свои резы/i;
```

Purpose: the "create light" spell is queued for memorization.
Example match: `Вы занесли заклинание "создать свет" в свои резы.`

### character-menu

```typescript
const CHARACTER_MENU_REGEXP = /Чего ваша душа желает\?/;
```

Purpose: detects the post-login character menu; controller auto-selects option `1`
(enter game) after a 5-second delay.
Example match: `Чего ваша душа желает?`

### follow-gg

```typescript
const FOLLOW_GG_REGEXP = /^(\S+) (?:дружине|сообщил[аи]? группе) : '(.+?)'\.?$/;
```

Purpose: follow-leader trigger for the group-chat channel. Group 1 is sender name,
group 2 is the command text.
Example match: `Магуша дружине : 'Ринли см'.`

### follow-gd

```typescript
const FOLLOW_GD_REGEXP = /^(\S+) клану: '(.+)'$/;
```

Purpose: follow-leader trigger for the clan channel.
Example match: `Магуша клану: '!отступ'`

### follow-tell

```typescript
const FOLLOW_TELL_REGEXP = /^(\S+) сказал вам : '!(.+)'$/;
```

Purpose: follow-leader trigger for personal tells prefixed with `!`.
Example match: `Магуша сказал вам : '!одеться'`

## src/survival-script.ts

### ansi-sequence

```typescript
const ANSI_SEQUENCE_REGEXP = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
```

Purpose: strip full-form ANSI escape sequences (not just color) before matching.
Duplication flag: identical regex in `src/map/parser.ts`, `src/farm2/types.ts`,
`src/container-tracker.ts`, `src/combat-state.ts`, `src/mob-resolver.ts`,
`src/equip-utils.ts`. Phase 2+ candidate for consolidation into `src/mud-text/strip.ts`.

### hunger

```typescript
const HUNGER_REGEXP = /Вы (?:голодны|очень голодны|готовы сожрать быка)/i;
```

Purpose: detects hunger-level phrases (three escalating stages).
Example match: `Вы голодны.` or `Вы очень голодны.` or `Вы готовы сожрать быка.`

### thirst

```typescript
const THIRST_REGEXP = /Вас (?:мучает|сильно мучает) жажда|Вам хочется выпить озеро/i;
```

Purpose: detects thirst-level phrases (three escalating stages).
Example match: `Вас мучает жажда.` or `Вам хочется выпить озеро.`

### satiated

```typescript
const SATIATED_REGEXP = /Вы полностью насытились|Вы наелись/i;
```

Purpose: clears hunger flag after successful eat.
Example match: `Вы полностью насытились.` or `Вы наелись.`

### too-full

```typescript
const TOO_FULL_REGEXP = /Вы слишком сыты для этого/i;
```

Purpose: clears hunger flag when eating is rejected by server.
Example match: `Вы слишком сыты для этого.`

### thirst-quenched

```typescript
const THIRST_QUENCHED_REGEXP = /Вы не чувствуете жажды/i;
```

Purpose: clears thirst flag after successful drink.
Example match: `Вы не чувствуете жажды.`

### drank

```typescript
const DRANK_REGEXP = /Вы выпили /i;
```

Purpose: clears thirst flag on drink action.
Example match: `Вы выпили немного воды.`

### item-line (used by parseInspectItems / parseInventoryItems)

```typescript
const ITEM_LINE_REGEXP = /^\s*(.+?)\s*(?:\[(\d+)\])?\s*$/;
```

Purpose: captures an item name and optional count from a `заглянуть`/`инв` listing.
Group 1: name; group 2: count (optional).
Example match: `зелёная гроздь ягод [3]` or `яблоко`.

### prompt-line

```typescript
const PROMPT_LINE_REGEXP = /^\s*\d+H\s+\d+M\b/i;
```

Purpose: detects a prompt line so the inspect-items parser knows to stop scanning.
Example match: `150H 200M 50o` (start of the standard prompt)

### container-keywords

```typescript
const CONTAINER_KEYWORDS_REGEXP = /торб|сунд|\(пуст|\(есть содержимое/i;
```

Purpose: detects container-type inventory lines that should be skipped by
`parseInventoryItems` (containers are enumerated separately via `заглянуть`).
Example match: `торба охотника` or `сундук (пуст)`.

## src/bazaar-notifier.ts

### bazaar-new-lot

```typescript
const BAZAAR_NEW_LOT_RE = /Базар\s*:\s*новый лот\s*\((\d+)\)\s*-\s*(.+?)\s*-\s*цена\s*([\d ]+)\s*кун/i;
```

Purpose: detects bazaar lot announcements. Captures lot id, item name, price.
Example match: `Базар : новый лот (103) - куртка танцующей тени - цена 10000 кун`

### bonus-start

```typescript
const BONUS_START_RE = /\*{3}\s*Объявляется\s+(.+?бонус.+?)\s+на\s+(\d+)\s+часо[вa]\.\s*\*{3}/i;
```

Purpose: detects the start-of-bonus announcement (double-xp, weapon-xp, etc.).
Captures bonus type and duration.
Example match: `*** Объявляется двойной бонус опыта на 24 часов. ***`

### bonus-remaining

```typescript
const BONUS_REMAINING_RE = /До конца бонуса осталось\s+(\d+)\s+часо[вa]\./i;
```

Purpose: periodic remaining-time announcement. Notification fires only for 1/2/3 hour
values (see `BONUS_REMAINING_NOTIFY_HOURS`).
Example match: `До конца бонуса осталось 3 часов.`

### bonus-ended

```typescript
const BONUS_ENDED_RE = /Бонус закончился\.\.\./i;
```

Purpose: detects bonus termination.
Example match: `Бонус закончился...`

### auction-new-lot

```typescript
const AUCTION_NEW_LOT_RE = /Аукцион\s*:\s*новый лот\s+\d+\s*-\s*(.+?)\s*-\s*начальная ставка\s*([\d ]+)\s*кун/i;
```

Purpose: detects auction-lot announcements. Captures item name and starting bid.
Example match: `Аукцион : новый лот 0 - шлем трёх звёзд - начальная ставка 5000 кун.`

### auction-new-bid

```typescript
const AUCTION_NEW_BID_RE = /Аукцион\s*:\s*лот\s+\d+\((.+?)\)\s*-\s*новая ставка\s*([\d ]+)\s*кун/i;
```

Purpose: detects new-bid announcements during an auction.
Example match: `Аукцион : лот 0(шлем трёх звёзд) - новая ставка 5500 кун.`

### ansi-escape

```typescript
const ANSI_ESCAPE_RE = /\u001b\[[0-9;]*m/g;
```

Purpose: strip ANSI color codes before bazaar/auction phrase matching.
Duplication flag: identical short-form ANSI regex in `src/server.ts`,
`src/triggers.ts`, `src/gather-script.ts`, `src/zone-scripts/farm-zone-executor2.ts`.

## src/map/parser.ts

### ansi-sequence

```typescript
const ANSI_SEQUENCE_REGEXP = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
```

Purpose: strip full-form ANSI escape sequences before line-level parsing.
Duplication flag: see `src/survival-script.ts` entry for the full duplicate list.

### room-header

```typescript
const ROOM_HEADER_REGEXP = /^(.+?)\s+\[(\d{3,})\]\s*$|^\[(\d{3,})\]\s+(.+?)\s*\[(?:[^\]]*)\]\s*$|^\[(\d{3,})\]\s+([^.[]+?)\s*$/;
```

Purpose: matches three variants of room headers. Each alternation branch handles one
observed Bylins output format.
Example matches:

- Trailing-vnum form: `Тренировочный зал [6049]`
- Leading-vnum with bracket tail: `[6049] Тренировочный зал [stuff]`
- Leading-vnum plain: `[6049] Тренировочный зал`

### exits-line

```typescript
const EXITS_LINE_REGEXP = /^\[\s*(?:exits?|выходы?)\s*:\s*(.*?)\s*\]\s*$/i;
```

Purpose: matches the exits line in both English and Russian forms.
Example match: `[ Exits: n s d ]` or `[ Выходы: с ю в ]`

### movement-blocked

```typescript
const MOVEMENT_BLOCKED_REGEXP = /Вы не сможете туда пройти|Вам сюда нельзя|Нет такого выхода|Вы не можете идти/i;
```

Purpose: detects "cannot go that way" family of MUD responses.
Example match: `Вы не сможете туда пройти.`

### flee

```typescript
const FLEE_REGEXP = /Вы быстро убежали с поля битвы|ПАНИКА ОВЛАДЕЛА ВАМИ|Ни за что! Вы сражаетесь за свою жизнь/i;
```

Purpose: detects combat flee / panic / no-flee outcomes.
Example match: `Вы быстро убежали с поля битвы.` or `ПАНИКА ОВЛАДЕЛА ВАМИ!`

### dark-room

```typescript
const DARK_ROOM_REGEXP = /^Слишком темно\b/i;
```

Purpose: detects a too-dark room so the parser avoids emitting a bogus room header.
Example match: `Слишком темно.`

Duplication flag: a companion regex in `src/farm2/types.ts` (identical literal) and a
slightly different variant in `src/triggers.ts` (`LIGHT_DARK_REGEXP`).

### movement

```typescript
const MOVEMENT_REGEXP = /Вы\s+(?:поплелись|пошли|побежали|полетели|поехали|поскакали|побрели|поплыли)(?:\s+следом\s+за\s+\S+)?\s+(?:на\s+)?(север|юг|восток|запад|вверх|вниз)\.?/i;
```

Purpose: detects "you moved <direction>" output. Group 1 captures the Russian
direction word; mapped to a `Direction` enum via `MOVEMENT_WORD_TO_DIRECTION`.
Example match: `Вы пошли на север.` or `Вы побежали следом за Магушей вверх.`

### mob-ansi-block

```typescript
const MOB_ANSI_BLOCK_REGEXP = /\u001b\[1;31m([\s\S]*?)\u001b\[(?:0;0|0)m/g;
```

Purpose: extracts mob descriptions from ANSI-colored text blocks. CRITICAL: requires
ANSI-not-yet-stripped input; preservation of this ordering during extraction is
load-bearing (PITFALLS.md Pitfall 4).
Example match: the red-bright-on sequence wrapping a mob name like `крыса`.

### prompt-mana-ansi

```typescript
const PROMPT_MANA_ANSI_REGEXP = /\u001b\[1;31m\d+M\u001b\[0;37m/g;
```

Purpose: matches the red-highlighted mana number inside a prompt so the parser can
ignore it when scanning for mob-ANSI blocks.

### target-prefix (parser copy)

```typescript
const TARGET_PREFIX_REGEXP = /^\([^)]*\)\s*/;
```

Purpose: strip a target prefix like `(прижав нож к горлу)` from the start of a line.
Duplication flag: identical regex in `src/farm2/types.ts` and `src/mob-resolver.ts`.

### item-ansi-block

```typescript
const ITEM_ANSI_BLOCK_REGEXP = /\u001b\[1;33m([\s\S]*?)\u001b\[(?:0;0|0)m/g;
```

Purpose: extracts item descriptions from yellow-bright ANSI blocks.

### corpse-line

```typescript
const CORPSE_LINE_REGEXP = /^Труп\s+.+лежит\s+здесь\.?\s*(?:\[(\d+)\])?\s*$/i;
```

Purpose: detects corpses lying in the current room; optional group 1 captures the
vnum if present.
Example match: `Труп крысы лежит здесь.` or `Труп крысы лежит здесь. [6049]`

### room-name-status-prefix

```typescript
const ROOM_NAME_STATUS_PREFIX_REGEXP = /^\d+H\s+\d+M\s+\d+o\b.*?>\s*/;
```

Purpose: strips the prompt prefix that sometimes appears at the start of a room-name
line when mud-output gets jammed together.
Example match (prefix portion): `150H 200M 50o Зауч:0 ОЗ:0 Вых:нюв>`

## src/farm2/types.ts

### ansi-sequence

```typescript
export const ANSI_SEQUENCE_REGEXP = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
```

Purpose: strip ANSI sequences before farm2 phrase matching.
Duplication flag: identical literal to `src/map/parser.ts` — two separate copies
because `farm2` currently cannot import from `map/parser` without a circular-dep
risk; Phase 2+ will consolidate.

### room-prompt

```typescript
export const ROOM_PROMPT_REGEXP = /Вых:[^>]*>/i;
```

Purpose: detects the room-prompt tail (exits followed by `>`). Marks end of a
room-render chunk.
Example match: `Вых:нюв>`
Duplication flag: identical literal to `src/combat-state.ts` and
`src/repair-script.ts`.

### target-not-visible

```typescript
export const TARGET_NOT_VISIBLE_REGEXP = /Вы не видите цели\.?|Кого вы так сильно ненавидите/i;
```

Purpose: detects that the chosen mob target is no longer visible/present. Farm2
reacts by picking a new target.
Example match: `Вы не видите цели.` or `Кого вы так сильно ненавидите?`
Duplication flag: identical to `src/combat-state.ts`.

### mob-arrival

```typescript
export const MOB_ARRIVAL_REGEXP =
  /^(.+?)\s+(?:приполз|приползла|приползли|прибежал|прибежала|прибежали|пришел|пришла|пришли|прилетел|прилетела|прилетели|прошмыгнул|прошмыгнула|прошмыгнули|прошмыгнуло)\s+с\s+\S+\.?$/i;
```

Purpose: detects new mob arrival into the current room. Group 1 captures the mob
description.
Example match: `Большая крыса пришла с севера.`

### target-prefix (farm2 copy)

```typescript
export const TARGET_PREFIX_REGEXP = /^\([^)]*\)\s*/;
```

Purpose: same as the parser.ts copy — strips `(action-in-progress)` prefixes.

### dark-room

```typescript
export const DARK_ROOM_REGEXP = /^Слишком темно\b/i;
```

Purpose: duplicate of `src/map/parser.ts::DARK_ROOM_REGEXP`. Farm2 needs its own copy
because it wants to pause movement when the room goes dark without going through the
parser.

### mob-death

```typescript
export const MOB_DEATH_REGEXP = /мертв[аео]?,\s+(?:его|её|ее|ее)\s+душа/i;
```

Purpose: detects the canonical mob-death phrase (`X мертв, его душа...`). Farm2 uses
this to advance its kill counter and pick the next mob.
Example match: `Крыса мертва, её душа полетела в Чертоги Богов...`

## src/server.ts

### ansi-escape

```typescript
const ANSI_ESCAPE_RE = /\u001b\[[0-9;]*m/g;
```

Purpose: strip ANSI before prompt/stats matching.
Duplication flag: third copy of the short-form ANSI regex — Phase 2+ candidate for
consolidation along with `src/bazaar-notifier.ts`, `src/triggers.ts`, etc.

### bazaar-sale

```typescript
const BAZAAR_SALE_RE = /Базар\s*:\s*лот\s+(\d+)\(([^)]+)\)\s+продан\S*\s+за\s+(\d+)\s+кун/;
```

Purpose: detects bazaar-lot-sold events (NOT our lot). Captures lot id, item, price.
Example match: `Базар : лот 42(плащ тени) продан за 8000 кун.`

### bazaar-our-sale

```typescript
const BAZAAR_OUR_SALE_RE = /Базар\s*:\s*лот\s+(\d+)\(([^)]+)\)\s+продан[^.]*\.\s+(\d+)\s+кун\s+переведено\s+на\s+ваш\s+счет/;
```

Purpose: detects when OUR bazaar lot sold (a separate MUD phrase includes the
wire-transfer notice).
Example match: `Базар : лот 17(шлем) продан незнакомцу. 10000 кун переведено на ваш счет.`

### auction-sale

```typescript
const AUCTION_SALE_RE = /Аукцион\s*:\s*лот\s+(\d+)\(([^)]+)\)\s+продан\S*\s+с\s+аукциона\s+за\s+(\d+)\s+кун/;
```

Purpose: detects auction-lot-sold events. Captures lot id, item, price.
Example match: `Аукцион : лот 0(шлем трёх звёзд) продан с аукциона за 7500 кун.`

### loot-from-corpse

```typescript
const LOOT_FROM_CORPSE_RE = /Вы взяли (.+?) из трупа /gi;
```

Purpose: detects items looted from a corpse. Captures the item name (group 1). Global
flag so multiple loots in a single chunk can be walked.
Example match: `Вы взяли ржавый меч из трупа крысы.`

### pickup-from-ground

```typescript
const PICKUP_FROM_GROUND_RE = /Вы подняли (?!труп\b)(.+?)\./gi;
```

Purpose: detects ground-pickups (negative lookahead excludes `труп` — corpse pickups
are handled separately).
Example match: `Вы подняли свиток.`

### max-stats

```typescript
const MAX_STATS_REGEXP = /Вы можете выдержать \d+\((\d+)\) единиц[а-я]* повреждения.*?пройти \d+\((\d+)\) верст/i;
```

Purpose: parses the self-`score` summary for max HP and max stamina.
Example match: `Вы можете выдержать 150(200) единиц повреждения...пройти 30(50) верст.`

### prompt-stats

```typescript
const PROMPT_STATS_REGEXP = /(\d+)H\s+(\d+)M\s+(\d+)o\s+Зауч:\d+\s+ОЗ:\d+.*?(\d+)L\s+\d+G/;
```

Purpose: parses the combat-prompt stats. Captures HP, mana, stamina-like, level.
Phase 2 SRV-01 will extract both `MAX_STATS_REGEXP` and `PROMPT_STATS_REGEXP` into
`src/controllers/stats-parser.ts`.
Example match: `150H 200M 50o Зауч:0 ОЗ:0 Вых:нюв> 25L 100G`

### prompt-level

```typescript
const PROMPT_LEVEL_REGEXP = /(\d+)L\s+\d+G/;
```

Purpose: quick standalone level extractor when the full prompt is not matched.
Example match: `25L 100G`

### ansi-escape-regexp (second alias)

```typescript
const ANSI_ESCAPE_REGEXP = /\u001b\[[0-9;]*m/g;
```

Purpose: second in-file copy of the same literal as `ANSI_ESCAPE_RE`. Exists because
two different call sites grew independently. Phase 2 extraction should collapse to
one.

### combat-prompt-mob

```typescript
const COMBAT_PROMPT_MOB_REGEXP = /\[([^\]:]+):[^\]]+\]/g;
```

Purpose: extracts mob names from the combat prompt (bracketed `[mob:hp]` tokens).
Example match: `[крыса:здоров]`

### razb

```typescript
const RAZB_REGEXP = /максимальной разницей в (\d+) уровн/i;
```

Purpose: parses the "level spread" phrase from `рассчитать` output. Group 1 is the
spread number used for DSU calculations.
Example match: `...с максимальной разницей в 3 уровня...`

## src/gather-script.ts

### ansi-escape

```typescript
const ANSI_ESCAPE_REGEXP = /\u001b\[[0-9;]*m/g;
```

Purpose: strip ANSI before gathering-phrase matching.
Duplication flag: same short-form as `src/server.ts`, `src/triggers.ts`,
`src/bazaar-notifier.ts`.

### berry

```typescript
const BERRY_REGEXP = /^Приглядевшись, вы видите ягоду (.+?)\.$/;
```

Purpose: detects a berry spotted in the current room. Group 1 captures the berry
species.
Example match: `Приглядевшись, вы видите ягоду малины.`

### herb

```typescript
const HERB_REGEXP = /^Среди разнотравья вы заметили (.+?)\.$/;
```

Purpose: detects an herb. Group 1 captures the herb name.
Example match: `Среди разнотравья вы заметили мяту.`

### mushroom

```typescript
const MUSHROOM_REGEXP = /^Гриб \((.+?)\) растет здесь\.$/;
```

Purpose: detects a mushroom. Group 1 captures the species in parentheses.
Example match: `Гриб (подосиновик) растет здесь.`

### branch

```typescript
const BRANCH_REGEXP = /^Отломанная ветка (.+?) сохнет здесь\.$/;
```

Purpose: detects a broken branch used for firewood gathering.
Example match: `Отломанная ветка дуба сохнет здесь.`

### iron

```typescript
const IRON_REGEXP = /^Маленький кусочек чугуна валяется в пыли\.$/;
```

Purpose: detects a cast-iron fragment. No capture group — phrase is a singleton.
Example match: `Маленький кусочек чугуна валяется в пыли.`

### puddle

```typescript
const PUDDLE_REGEXP = /^Лужица (.+?) разлита у ваших ног\.$/;
```

Purpose: detects a puddle (liquid resource). Group 1 captures the liquid type.
Example match: `Лужица воды разлита у ваших ног.`

## src/combat-state.ts

### ansi-sequence

```typescript
const ANSI_SEQUENCE_REGEXP = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
```

Purpose: strip ANSI before combat-prompt detection.
Duplication flag: identical to `src/map/parser.ts`, `src/survival-script.ts`,
`src/farm2/types.ts`, `src/container-tracker.ts`.

### combat-prompt

```typescript
const COMBAT_PROMPT_REGEXP = /\[[^:\]]+:[^\]]+\]\s+\[[^:\]]+:[^\]]+\]\s*>/;
```

Purpose: detects the combat-prompt shape (two bracketed actor:hp tokens followed by
`>`). Presence of this form flips `isInCombat()` to true.
Example match: `[крыса:здоров] [Вы:здоров]>`

### room-prompt

```typescript
const ROOM_PROMPT_REGEXP = /Вых:[^>]*>/i;
```

Purpose: detects the peacetime room-prompt tail. Presence flips `isInCombat()` back
to false.
Example match: `Вых:нюв>`
Duplication flag: same literal as `src/farm2/types.ts::ROOM_PROMPT_REGEXP` and
`src/repair-script.ts::PROMPT_REGEXP`.

### target-not-visible

```typescript
const TARGET_NOT_VISIBLE_REGEXP = /Вы не видите цели\.?|Кого вы так сильно ненавидите/i;
```

Purpose: duplicate of `src/farm2/types.ts::TARGET_NOT_VISIBLE_REGEXP`. Combat-state
reads it independently to clear its current-target reference.

## src/repair-script.ts

### repair-success

```typescript
const REPAIR_SUCCESS_REGEXP = /починил|починила/i;
```

Purpose: detects that the NPC smith successfully repaired the item.
Example match: `Кузнец починил ваш меч.`

### repair-fail

```typescript
const REPAIR_FAIL_REGEXP = /не может починить|не умеет|не знает как|Чаво\?|не нужно чинить|не буду тратить/i;
```

Purpose: detects any of the repair-refusal phrases (smith can't, won't, item is fine,
etc.).
Example match: `Кузнец не может починить это.` or `Чаво?`

### prompt (repair-script local copy)

```typescript
const PROMPT_REGEXP = /Вых:[^>]*>/i;
```

Purpose: scoped copy of the room-prompt detector. Repair script needs to wait until
command output settles before issuing the next repair.

## src/container-tracker.ts

### ansi-strip

```typescript
const ANSI_STRIP_REGEXP = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
```

Purpose: strip full-form ANSI; duplicate of the full-form family.

### prompt

```typescript
const PROMPT_REGEXP = /\d+H\s+\d+M\b/i;
```

Purpose: prompt detector used to segment container listings.

### equipped-slot

```typescript
const EQUIPPED_SLOT_REGEXP = /^<([^>]+)>\s+(.+?)\s+<[а-яё ]+>$/i;
```

Purpose: parses an equipment-line with a slot tag on both ends. Group 1 is slot name,
group 2 is item description.
Example match: `<в правой руке>     нож мастера-оружейника <хорошее состояние>`

## src/zone-scripts/farm-zone-executor2.ts

### ansi

```typescript
const ANSI_RE = /\u001b\[[0-9;]*m/g;
```

Purpose: strip ANSI for zone-script pattern matching. Short-form duplicate.

## src/mob-resolver.ts

### ansi-sequence

```typescript
const ANSI_SEQUENCE_REGEXP = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
```

Purpose: strip ANSI before mob-name resolution. Full-form duplicate.

### target-prefix

```typescript
const TARGET_PREFIX_REGEXP = /^\([^)]*\)\s*/;
```

Purpose: duplicate of `src/map/parser.ts::TARGET_PREFIX_REGEXP` — strips
`(action)` prefixes. Scoped copy so the resolver can normalize mob descriptions
independently.

## src/compare-scan/index.ts

### prompt

```typescript
const PROMPT_RE = /\d+H\s+\d+M\b/;
```

Purpose: prompt detector for compare-scan pager logic.

### pager

```typescript
const PAGER_RE = /RETURN|нажмите\s+\[?return\]?|нажмите\s+enter|\[.*продолжени/i;
```

Purpose: detects the MUD's pager prompt (English or Russian variants).
Example match: `Нажмите [RETURN] для продолжения` or `нажмите enter`

### end-of-list

```typescript
const END_OF_LIST_RE = /конец\s+списка|список\s+пуст|нет\s+предметов|nothing\s+for\s+sale/i;
```

Purpose: detects that a paged listing has ended.
Example match: `конец списка` or `nothing for sale`

### bazaar-pager

```typescript
const BAZAAR_PAGER_RE = /Листать\s*:/i;
```

Purpose: detects the bazaar-specific pager prompt.
Example match: `Листать : далее/назад/выход`

### bazaar-end

```typescript
const BAZAAR_END_RE = /список\s+пуст|нет\s+предметов|нет\s+лотов/i;
```

Purpose: detects that a bazaar listing has ended.

### bazaar-line

```typescript
const BAZAAR_LINE_RE = /^\s*\[\s*(\d+)\]\s+(.+?)\s{2,}(\d+)\s+\S+\s*$/;
```

Purpose: parses a single bazaar row. Group 1: lot id. Group 2: item name. Group 3:
price.
Example match: `  [ 42]  плащ тени          8000  кун`

### guild-storage-start

```typescript
const GUILD_STORAGE_START_RE = /хранилище вашей дружины/i;
```

Purpose: detects the start of the guild-storage listing.

### guild-storage-line

```typescript
const GUILD_STORAGE_LINE_RE = /^(.+?)\s+\[(\d+)\s+кун[ыа]?\]\s*$/;
```

Purpose: parses a single guild-storage row. Group 1: item name. Group 2: price.
Example match: `шлем трёх звёзд [5000 куны]`

### guild-storage-pager

```typescript
const GUILD_STORAGE_PAGER_RE = /Листать\s*:/i;
```

Purpose: duplicate of `BAZAAR_PAGER_RE` — same pager prompt, scoped to the
guild-storage block.

### guild-storage-end

```typescript
const GUILD_STORAGE_END_RE = /конец\s+списка|хранилище\s+пусто/i;
```

Purpose: detects the end of the guild-storage listing.

### inventory-start

```typescript
const INVENTORY_START_RE = /^Вы несете:/;
```

Purpose: detects the start of `инв` (inventory) output.
Example match: `Вы несете:`

### inventory-item

```typescript
const INVENTORY_ITEM_RE = /^([^\[]+?)(?:\s{2,}|\[|\s*$)/;
```

Purpose: parses a single inventory row. Group 1: item name (up to the first
double-space, bracket, or EOL).

## src/equip-utils.ts

### ansi-sequence

```typescript
export const ANSI_SEQUENCE_REGEXP = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
```

Purpose: strip ANSI before equip-line parsing. Full-form duplicate.

### equip-line

```typescript
export const EQUIP_LINE_REGEXP = /^<([^>]+)>\s+(.+?)\s+<([^>]+)>\s*(?:\.\..*)?$/;
```

Purpose: parses a full equip line with slot-name and condition-tag. Group 1: slot
name; group 2: item name; group 3: condition tag.
Example match: `<для освещения>     светящийся шарик <хорошее состояние>`
