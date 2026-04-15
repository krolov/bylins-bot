import type { ColumnDef, HotkeyEntry } from "./types.ts";

export const VOROZHE_CITIES = [
  "Брянск", "Великий Новгород", "Владимир", "Вышгород", "Галич",
  "Искоростень", "Киев", "Корсунь", "Курск", "Ладога",
  "Любеч", "Меньск", "Муром", "Переяславль", "Полоцк",
  "Псков", "Путивль", "Ростов Великий", "Русса", "Рязань",
  "Тверь", "Торжок", "Тотьма", "Туров", "Чернигов",
] as const;

export const WEAPON_COLUMNS: ColumnDef[] = [
  { label: "Класс",     render: d => String(d.weaponClass ?? d.class ?? "—"),      cls: "items-modal__cell--muted" },
  { label: "Кубики",    render: d => String(d.damageDice ?? d.damage_dice ?? "—"), cls: "items-modal__cell--mono" },
  { label: "Avg",       render: d => (d.damageAvg ?? d.damage_avg) != null ? String(d.damageAvg ?? d.damage_avg) : "—", cls: "items-modal__cell--mono" },
  { label: "Материал",  render: d => String(d.material ?? "—"),                    cls: "items-modal__cell--muted" },
  { label: "Прочность", render: d => d.durability_cur != null ? `${d.durability_cur}/${d.durability_max}` : "—" },
  { label: "Аффекты",   render: d => Array.isArray(d.affects) ? (d.affects as string[]).join(", ") || "—" : String(d.affects ?? "—"), cls: "items-modal__cell--tag" },
  { label: "Свойства",  render: d => Array.isArray(d.properties) ? (d.properties as string[]).join(", ") || "—" : String(d.extra_props ?? "—"), cls: "items-modal__cell--tag" },
];

export const ARMOR_COLUMNS: ColumnDef[] = [
  { label: "Слот",      render: d => Array.isArray(d.wearSlots) ? (d.wearSlots as {slot:string}[]).map(s => typeof s === "string" ? s : s.slot).join(", ") || "—" : String(d.wear_slot ?? d.slot ?? "—"), cls: "items-modal__cell--muted" },
  { label: "Материал",  render: d => String(d.material ?? "—"),  cls: "items-modal__cell--muted" },
  { label: "Прочность", render: d => d.durability_cur != null ? `${d.durability_cur}/${d.durability_max}` : "—" },
  { label: "AC",        render: d => String(d.ac ?? d.armor ?? "—"), cls: "items-modal__cell--mono" },
  { label: "Аффекты",   render: d => Array.isArray(d.affects) ? (d.affects as string[]).join(", ") || "—" : String(d.affects ?? "—"), cls: "items-modal__cell--tag" },
  { label: "Свойства",  render: d => Array.isArray(d.properties) ? (d.properties as string[]).join(", ") || "—" : String(d.extra_props ?? "—"), cls: "items-modal__cell--tag" },
];

export const AVAILABLE_ZONE_SCRIPTS: Array<{ zoneId: number; name: string; hundreds: number[]; stepLabels: string[] }> = [
  {
    zoneId: 258,
    name: "Лес (зона 258)",
    hundreds: [258],
    stepLabels: [
      "Идти на 25804",
      "Открыть дверь",
      "Идти на 25805",
      "Ждать сообщение про лавочку",
      "Идти назад на 25804",
      "Двигать лавочку",
      "Взять ключ",
      "Идти на 25805",
      "Отпереть и открыть дверь",
      "Открыть дверь",
      "Идти на 25806",
      "Ждать реплику старика про шар",
      "Ответить: помогу",
      "Идти на 25807",
      "Раздвинуть ветки",
      "Идти на 25837",
      "Лезть на дуб",
      "Ждать появления духа леса",
      "Спросить про карликов",
      "Согласиться на задание духа",
      "Спуститься к дубу (25837)",
      "Лезть вниз",
      "Нырнуть в озеро",
    ],
  },
  {
    zoneId: 280,
    name: "Стоянка половцев",
    hundreds: [280],
    stepLabels: [
      "Идти к входу в стоянку (28000)",
      "Зачистить стоянку половцев",
    ],
  },
  {
    zoneId: 286,
    name: "Птичий бор (286)",
    hundreds: [286],
    stepLabels: [
      "Идти к входу в зону (28664)",
      "Зачистить основную часть зоны (без камыша)",
      "Идти к камышу (28629)",
      "Раздвинуть камыш",
      "Зачистить камышовую часть (стелс)",
      "Вернуться к входу (28664)",
    ],
  },
  {
    zoneId: 111,
    name: "Лесная зона (111)",
    hundreds: [111],
    stepLabels: [
      "Идти к входу в лесную зону (11186)",
      "Зачистить лесную зону (стелс)",
    ],
  },
  {
    zoneId: 102,
    name: "Дубрава (102)",
    hundreds: [102],
    stepLabels: [
      "Идти к входу в дубраву (10200)",
      "Зачистить дубраву (стелс)",
    ],
  },
  {
    zoneId: 103,
    name: "Латинский монастырь (103)",
    hundreds: [103],
    stepLabels: [
      "Идти к входу в монастырь (10300)",
      "Зачистить латинский монастырь (стелс)",
    ],
  },
  {
    zoneId: 104,
    name: "Купеческая усадьба (104)",
    hundreds: [104],
    stepLabels: [
      "Идти к входу в усадьбу (10400)",
      "Зачистить купеческую усадьбу (стелс)",
    ],
  },
];

export const DIR_DELTA: Record<string, [number, number]> = {
  north: [0, 1],
  south: [0, -1],
  east: [1, 0],
  west: [-1, 0],
};

export const OPPOSITE_DIR: Record<string, string> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
};

export const DIRECTION_PRIORITY: Record<string, number> = {
  north: 0,
  east: 1,
  south: 2,
  west: 3,
  up: 4,
  down: 5,
};

export const SCRIPT_STEP_ICONS: Record<string, string> = {
  pending: "○",
  active: "▶",
  done: "✓",
  error: "✗",
  skipped: "–",
};

export const DEFAULT_HOTKEYS: HotkeyEntry[] = [
  { key: "ArrowUp",        command: "север",   label: "↑" },
  { key: "ArrowDown",      command: "юг",      label: "↓" },
  { key: "ArrowLeft",      command: "запад",   label: "←" },
  { key: "ArrowRight",     command: "восток",  label: "→" },
  { key: "Opt+ArrowUp",    command: "#go с",   label: "Opt+↑" },
  { key: "Opt+ArrowDown",  command: "#go ю",   label: "Opt+↓" },
  { key: "Opt+ArrowLeft",  command: "#go з",   label: "Opt+←" },
  { key: "Opt+ArrowRight", command: "#go в",   label: "Opt+→" },
  { key: "KeyZ",           command: "карта",   label: "Я" },
  { key: "KeyX",           command: "огл",     label: "Ч" },
  { key: "KeyW",           command: "заколоть $target", label: "Ц" },
  { key: "KeyA",           command: "освеж тр", label: "Ф" },
  { key: "KeyQ",           command: "взя все.тр;;взя все все.тр;;бро все.тр", label: "Й" },
  { key: "Digit5",         command: "взя возвр склад;;зачит возвр;;держ лев.рук", label: "5" },
];
