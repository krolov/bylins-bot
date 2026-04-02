export type ItemName =
  | "ягода"
  | "гриб"
  | "ветка"
  | "зуб"
  | "тварь"
  | "камень"
  | "металл"
  | "минерал"
  | "сердце"
  | "печень";

export interface VorozheEdge {
  from: string;
  to: string;
  items: ItemName[];
}

export const ALL_CITIES = [
  "Брянск",
  "Великий Новгород",
  "Владимир",
  "Вышгород",
  "Галич",
  "Искоростень",
  "Киев",
  "Корсунь",
  "Курск",
  "Ладога",
  "Любеч",
  "Меньск",
  "Муром",
  "Переяславль",
  "Полоцк",
  "Псков",
  "Путивль",
  "Ростов Великий",
  "Русса",
  "Рязань",
  "Тверь",
  "Торжок",
  "Тотьма",
  "Туров",
  "Чернигов",
] as const;

export type CityName = (typeof ALL_CITIES)[number];

export const VOROZHE_EDGES: VorozheEdge[] = [
  { from: "Брянск", to: "Киев", items: ["ветка", "гриб"] },
  { from: "Брянск", to: "Туров", items: ["печень", "ягода"] },
  { from: "Великий Новгород", to: "Вышгород", items: ["ветка", "ягода"] },
  { from: "Великий Новгород", to: "Любеч", items: ["зуб", "тварь"] },
  { from: "Великий Новгород", to: "Псков", items: ["сердце", "гриб"] },
  { from: "Владимир", to: "Великий Новгород", items: ["ветка", "гриб"] },
  { from: "Владимир", to: "Муром", items: ["камень", "ягода"] },
  { from: "Вышгород", to: "Переяславль", items: ["ягода", "гриб"] },
  { from: "Вышгород", to: "Псков", items: ["камень", "зуб"] },
  { from: "Галич", to: "Курск", items: ["камень", "металл"] },
  { from: "Галич", to: "Русса", items: ["ягода", "ветка"] },
  { from: "Искоростень", to: "Брянск", items: ["гриб", "сердце"] },
  { from: "Искоростень", to: "Корсунь", items: ["ветка", "ягода"] },
  { from: "Киев", to: "Брянск", items: ["зуб", "тварь"] },
  { from: "Киев", to: "Корсунь", items: ["ветка", "ягода"] },
  { from: "Корсунь", to: "Киев", items: ["ягода", "гриб"] },
  { from: "Корсунь", to: "Русса", items: ["металл", "камень"] },
  { from: "Курск", to: "Корсунь", items: ["ветка", "ягода"] },
  { from: "Курск", to: "Ладога", items: ["зуб", "гриб"] },
  { from: "Ладога", to: "Киев", items: ["ветка", "ягода"] },
  { from: "Ладога", to: "Меньск", items: ["зуб", "минерал"] },
  { from: "Ладога", to: "Путивль", items: ["металл", "гриб"] },
  { from: "Любеч", to: "Корсунь", items: ["ягода", "гриб"] },
  { from: "Любеч", to: "Ростов Великий", items: ["металл", "печень"] },
  { from: "Меньск", to: "Великий Новгород", items: ["ветка", "минерал"] },
  { from: "Меньск", to: "Владимир", items: ["гриб", "тварь"] },
  { from: "Муром", to: "Вышгород", items: ["металл", "зуб"] },
  { from: "Муром", to: "Русса", items: ["ветка", "ягода"] },
  { from: "Переяславль", to: "Киев", items: ["ягода", "гриб"] },
  { from: "Переяславль", to: "Русса", items: ["металл", "камень"] },
  { from: "Полоцк", to: "Киев", items: ["ветка", "гриб"] },
  { from: "Полоцк", to: "Чернигов", items: ["металл", "сердце"] },
  { from: "Псков", to: "Галич", items: ["камень", "ягода"] },
  { from: "Псков", to: "Курск", items: ["зуб", "металл"] },
  { from: "Путивль", to: "Великий Новгород", items: ["ветка", "гриб"] },
  { from: "Путивль", to: "Владимир", items: ["ягода", "камень"] },
  { from: "Русса", to: "Киев", items: ["ягода", "гриб"] },
  { from: "Русса", to: "Курск", items: ["камень", "гриб"] },
  { from: "Рязань", to: "Ладога", items: ["металл", "ветка"] },
  { from: "Рязань", to: "Торжок", items: ["камень", "ягода"] },
  { from: "Тверь", to: "Вышгород", items: ["ягода", "гриб"] },
  { from: "Тверь", to: "Искоростень", items: ["камень", "металл"] },
  { from: "Торжок", to: "Галич", items: ["ветка", "тварь"] },
  { from: "Торжок", to: "Корсунь", items: ["гриб", "ягода"] },
  { from: "Тотьма", to: "Галич", items: ["ягода", "гриб"] },
  { from: "Тотьма", to: "Ладога", items: ["тварь", "зуб"] },
  { from: "Тотьма", to: "Русса", items: ["камень", "ветка"] },
  { from: "Туров", to: "Вышгород", items: ["ветка", "ягода"] },
  { from: "Туров", to: "Переяславль", items: ["гриб", "печень"] },
  { from: "Чернигов", to: "Владимир", items: ["металл", "сердце"] },
  { from: "Чернигов", to: "Торжок", items: ["ягода", "ветка"] },
];

const EDGE_INDEX = new Map<string, VorozheEdge[]>();
for (const edge of VOROZHE_EDGES) {
  const list = EDGE_INDEX.get(edge.from) ?? [];
  list.push(edge);
  EDGE_INDEX.set(edge.from, list);
}

export interface RouteStep {
  from: string;
  to: string;
  items: ItemName[];
}

export interface RouteResult {
  found: boolean;
  steps: RouteStep[];
  totalItems: Partial<Record<ItemName, number>>;
}

export function findVorozheRoute(from: string, to: string): RouteResult {
  if (from === to) {
    return { found: true, steps: [], totalItems: {} };
  }

  const queue: Array<{ city: string; path: VorozheEdge[] }> = [{ city: from, path: [] }];
  const visited = new Set<string>([from]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbours = EDGE_INDEX.get(current.city) ?? [];

    for (const edge of neighbours) {
      if (visited.has(edge.to)) continue;
      const newPath = [...current.path, edge];

      if (edge.to === to) {
        const steps: RouteStep[] = newPath.map((e) => ({
          from: e.from,
          to: e.to,
          items: e.items,
        }));
        return { found: true, steps, totalItems: sumItems(steps) };
      }

      visited.add(edge.to);
      queue.push({ city: edge.to, path: newPath });
    }
  }

  return { found: false, steps: [], totalItems: {} };
}

function sumItems(steps: RouteStep[]): Partial<Record<ItemName, number>> {
  const result: Partial<Record<ItemName, number>> = {};
  for (const step of steps) {
    for (const item of step.items) {
      result[item] = (result[item] ?? 0) + 1;
    }
  }
  return result;
}
