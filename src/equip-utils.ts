export const ANSI_SEQUENCE_REGEXP = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

// Формат: <слот>   название предмета   <состояние>   ..флаги
export const EQUIP_LINE_REGEXP = /^<([^>]+)>\s+(.+?)\s+<([^>]+)>\s*(?:\.\..*)?$/;

export interface EquipLine {
  slot: string;
  name: string;
  condition: string;
}

export function parseEquipLine(line: string): EquipLine | null {
  const match = EQUIP_LINE_REGEXP.exec(line.trim());
  if (!match) return null;

  const slot = match[1]!.trim();
  const name = match[2]!.trim();
  const condition = match[3]!.trim();

  if (!name || name === "нет" || name === "-") return null;

  return { slot, name, condition };
}

// Правая рука → воор, левая рука → держ, остальные → надеть
export function getEquipCommand(slot: string, keyword: string): string {
  if (slot === "в правой руке") return `воор !${keyword}!`;
  if (slot === "в левой руке") return `держ !${keyword}!`;
  return `надеть !${keyword}!`;
}

export function extractKeyword(itemName: string): string {
  const cleaned = itemName.trim().toLowerCase();
  const withoutSuffix = cleaned.replace(/\s+\.\..*$/, "").trim();
  return withoutSuffix.split(/\s+/)[0] ?? withoutSuffix;
}

export async function sendSequence(
  commands: string,
  send: (cmd: string) => void,
  delayMs: number,
): Promise<void> {
  const parts = commands.split(";").map((p) => p.trim()).filter((p) => p.length > 0);
  for (let i = 0; i < parts.length; i++) {
    send(parts[i]!);
    if (i < parts.length - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
