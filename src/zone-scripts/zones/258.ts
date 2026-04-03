import type { ScriptStep } from "../types.ts";

export const ZONE_258_ID = 258;
export const ZONE_258_NAME = "Лес (зона 258)";

export const zone258Steps: ScriptStep[] = [
  {
    kind: "navigate",
    label: "Идти на 25804",
    targetVnum: 25804,
  },
  {
    kind: "command",
    label: "Открыть дверь",
    command: "открыть дверь",
    delayAfterMs: 500,
  },
  {
    kind: "navigate",
    label: "Идти на 25805",
    targetVnum: 25805,
  },
  {
    kind: "wait_text",
    label: "Ждать сообщение про лавочку",
    pattern: /Отодвинь её и открой меня/i,
    timeoutMs: 60_000,
  },
  {
    kind: "navigate",
    label: "Идти назад на 25804",
    targetVnum: 25804,
  },
  {
    kind: "command",
    label: "Двигать лавочку",
    command: "двигать лавочку",
    delayAfterMs: 500,
  },
  {
    kind: "command",
    label: "Взять ключ",
    command: "взять ключ",
    delayAfterMs: 300,
  },
  {
    kind: "navigate",
    label: "Идти на 25805",
    targetVnum: 25805,
  },
  {
    kind: "command",
    label: "Отпереть и открыть дверь",
    command: "отпереть дверь",
    delayAfterMs: 500,
  },
  {
    kind: "command",
    label: "Открыть дверь",
    command: "открыть дверь",
    delayAfterMs: 500,
  },
  {
    kind: "navigate",
    label: "Идти на 25806",
    targetVnum: 25806,
  },
  {
    kind: "wait_text",
    label: "Ждать реплику старика про шар",
    pattern: /хрустальный шар/i,
    timeoutMs: 60_000,
  },
  {
    kind: "command",
    label: "Ответить: помогу",
    command: "г помогу",
    delayAfterMs: 300,
  },
  {
    kind: "navigate",
    label: "Идти на 25807",
    targetVnum: 25807,
  },
  {
    kind: "command",
    label: "Раздвинуть ветки",
    command: "раздвинуть ветки",
    delayAfterMs: 500,
  },
  {
    kind: "navigate",
    label: "Идти на 25837",
    targetVnum: 25837,
  },
  {
    kind: "special_move",
    label: "Лезть на дуб",
    command: "лезть дуб",
    targetVnum: 25842,
    timeoutMs: 10_000,
  },
  {
    kind: "wait_text",
    label: "Ждать появления духа леса",
    pattern: /Желтоглазый дух леса/i,
    timeoutMs: 30_000,
  },
  {
    kind: "command_and_wait",
    label: "Спросить про карликов",
    command: "г карлики",
    pattern: /Если выполнишь мое задание/i,
    timeoutMs: 30_000,
  },
  {
    kind: "command_and_wait",
    label: "Согласиться на задание духа",
    command: "г выполню",
    pattern: /расскажу как найти карликов/i,
    timeoutMs: 30_000,
  },
  {
    kind: "navigate",
    label: "Спуститься к дубу (25837)",
    targetVnum: 25837,
  },
  {
    kind: "special_move",
    label: "Лезть вниз",
    command: "лезть вниз",
    targetVnum: 25851,
    timeoutMs: 10_000,
  },
  {
    kind: "special_move",
    label: "Нырнуть в озеро",
    command: "нырнуть в озеро",
    targetVnum: 25851,
    timeoutMs: 10_000,
  },
];
