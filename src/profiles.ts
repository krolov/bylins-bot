export interface CharacterProfile {
  /** Уникальный идентификатор профиля (латиница, без пробелов) */
  id: string;
  /** Отображаемое имя в UI */
  name: string;
  /** Команды после подключения к MUD (меню + логин + пароль) */
  startupCommands: string[];
  /** Задержка между командами, мс */
  commandDelayMs: number;
  /** Использовать этот профиль как основной для расчёта снаряжения */
  gearProfile: boolean;
  /** Использовать стелс-режим боя (краст + закол + беж). Для татей. */
  stealthCombat?: boolean;
}

export const profiles: CharacterProfile[] = [
  {
    id: "voinmir",
    name: "Воинмир",
    startupCommands: ["5", "воинмир", "respect1", ""],
    commandDelayMs: 150,
    gearProfile: true,
  },
  {
    id: "alrug",
    name: "Алруг",
    startupCommands: ["5", "алруг", "respect1", ""],
    commandDelayMs: 150,
    gearProfile: false,
  },
  {
    id: "rinli",
    name: "Ринли",
    startupCommands: ["5", "ринли", "respect1", ""],
    commandDelayMs: 150,
    gearProfile: false,
    stealthCombat: true,
  },
];

/** Профиль, используемый по умолчанию при старте сервера */
export const defaultProfileId: string = "voinmir";
