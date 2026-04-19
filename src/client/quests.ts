import type { ClientEvent, QuestPayload } from "./types.ts";
import * as bus from "./bus.ts";

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required UI element: ${selector}`);
  return element;
}

const questsPanel = requireElement<HTMLDivElement>("#quests-panel");

function parseGrivnas(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export function initQuestsPanel(sendEvent: (event: ClientEvent) => void): void {
  let quests: QuestPayload[] = [];

  function requestQuests(): void {
    sendEvent({ type: "quests_get" });
  }

  function render(): void {
    questsPanel.replaceChildren();

    const now = Date.now();
    const visible = quests.filter(
      (q) => q.cooldownUntil === null || q.cooldownUntil <= now,
    );

    if (visible.length === 0) {
      questsPanel.textContent = quests.length === 0 ? "Квесты не загружены." : "Нет доступных квестов.";
      return;
    }

    let currentRegion: string | null = null;

    for (const quest of visible) {
      if (quest.region !== currentRegion) {
        currentRegion = quest.region;
        const region = document.createElement("div");
        region.className = "quests-region";
        region.textContent = quest.region;
        questsPanel.appendChild(region);
      }

      const card = document.createElement("div");
      card.className = "quest-card";

      const header = document.createElement("div");
      header.className = "quest-card__header";

      const name = document.createElement("span");
      name.className = "quest-card__name";
      name.textContent = quest.name;
      header.appendChild(name);

      if (quest.wikiUrl.length > 0) {
        const wikiLink = document.createElement("a");
        wikiLink.className = "quest-card__wiki";
        wikiLink.href = quest.wikiUrl;
        wikiLink.target = "_blank";
        wikiLink.rel = "noreferrer noopener";
        wikiLink.textContent = "wiki";
        header.appendChild(wikiLink);
      }

      card.appendChild(header);

      const footer = document.createElement("div");
      footer.className = "quest-card__footer";

      const grivnasLabel = document.createElement("label");
      grivnasLabel.className = "quest-card__grivnas-label";
      grivnasLabel.textContent = "грн";
      footer.appendChild(grivnasLabel);

      const grivnasInput = document.createElement("input");
      grivnasInput.type = "number";
      grivnasInput.min = "0";
      grivnasInput.placeholder = "0";
      grivnasInput.className = "quest-card__grivnas";
      grivnasInput.value = quest.grivnas === null ? "" : String(quest.grivnas);
      grivnasInput.addEventListener("blur", () => {
        const nextGrivnas = parseGrivnas(grivnasInput.value);
        if (nextGrivnas === quest.grivnas) {
          grivnasInput.value = quest.grivnas === null ? "" : String(quest.grivnas);
          return;
        }
        sendEvent({ type: "quest_set_grivnas", payload: { questId: quest.id, grivnas: nextGrivnas } });
      });
      footer.appendChild(grivnasInput);

      const doneButton = document.createElement("button");
      doneButton.type = "button";
      doneButton.className = "button-secondary quest-card__done";
      doneButton.textContent = "Выполнен";
      doneButton.addEventListener("click", () => {
        sendEvent({ type: "quest_complete", payload: { questId: quest.id } });
      });
      footer.appendChild(doneButton);

      card.appendChild(footer);
      questsPanel.appendChild(card);
    }
  }

  bus.on<{ quests: QuestPayload[] }>("quests_data", (payload) => {
    quests = payload.quests;
    render();
  });

  bus.on("quests_tab_activated", () => requestQuests());

  setInterval(() => {
    if (quests.length === 0) return;
    const now = Date.now();
    const expired = quests.some((q) => q.cooldownUntil !== null && q.cooldownUntil <= now);
    if (expired) { requestQuests(); return; }
    render();
  }, 60000);
}
