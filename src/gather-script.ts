const ANSI_ESCAPE_REGEXP = /\u001b\[[0-9;]*m/g;

// Pattern 1: "Приглядевшись, вы видите ягоду X."
const BERRY_REGEXP = /^Приглядевшись, вы видите ягоду (.+?)\.$/;

// Pattern 2: "Среди разнотравья вы заметили X."
const HERB_REGEXP = /^Среди разнотравья вы заметили (.+?)\.$/;

// Pattern 3: "Гриб (X) растет здесь."
const MUSHROOM_REGEXP = /^Гриб \((.+?)\) растет здесь\.$/;

// Pattern 4: "Отломанная ветка X сохнет здесь."
const BRANCH_REGEXP = /^Отломанная ветка (.+?) сохнет здесь\.$/;

// Pattern 5: "Маленький кусочек чугуна валяется в пыли."
const IRON_REGEXP = /^Маленький кусочек чугуна валяется в пыли\.$/;


const SKIP_LAST_WORDS = new Set(["разрыв-траву", "разрыв-трава", "траву", "гриб"]);

function lastWord(s: string): string {
  return s.trim().split(/\s+/).at(-1) ?? s.trim();
}

export interface GatherState {
  enabled: boolean;
  bag: string;
}

interface GatherControllerDependencies {
  sendCommand(command: string): void;
  onLog(message: string): void;
}

export function createGatherController(deps: GatherControllerDependencies) {
  let enabled = false;
  let bag = "сунду";

  function handleMudText(text: string): void {
    if (!enabled) return;

    const stripped = text.replace(ANSI_ESCAPE_REGEXP, "");
    const seen = new Set<string>();

    for (const rawLine of stripped.split("\n")) {
      const line = rawLine.trim();
      if (!line || seen.has(line)) continue;
      seen.add(line);
      processLine(line);
    }
  }

  function processLine(line: string): void {
    const berryMatch = BERRY_REGEXP.exec(line);
    if (berryMatch) {
      const word = lastWord(berryMatch[1]);
      if (!SKIP_LAST_WORDS.has(word)) pickup(word);
      return;
    }

    const herbMatch = HERB_REGEXP.exec(line);
    if (herbMatch) {
      const word = lastWord(herbMatch[1]);
      if (!SKIP_LAST_WORDS.has(word)) pickup(word);
      return;
    }

    const mushroomMatch = MUSHROOM_REGEXP.exec(line);
    if (mushroomMatch) {
      const word = lastWord(mushroomMatch[1]);
      if (!SKIP_LAST_WORDS.has(word)) pickup(word);
      return;
    }

    // Branches: MUD accepts keyword "ветку" to pick up whichever branch is present
    if (BRANCH_REGEXP.test(line)) {
      pickup("ветка");
      return;
    }

    if (IRON_REGEXP.test(line)) {
      pickup("кусочек");
      return;
    }
  }

  function pickup(item: string): void {
    deps.onLog(`[gather] взя ${item}; полож ${item} ${bag}`);
    deps.sendCommand(`взя ${item}`);
    deps.sendCommand(`полож ${item} ${bag}`);
  }

  function setEnabled(value: boolean): void {
    enabled = value;
  }

  function setBag(name: string): void {
    if (name.trim()) bag = name.trim();
  }

  function getState(): GatherState {
    return { enabled, bag };
  }

  return { handleMudText, setEnabled, setBag, getState };
}
