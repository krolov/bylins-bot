// "Базар : новый лот (103) - куртка танцующей тени - цена 10000 кун"
const BAZAAR_NEW_LOT_RE = /Базар\s*:\s*новый лот\s*\((\d+)\)\s*-\s*(.+?)\s*-\s*цена\s*([\d ]+)\s*кун/i;
// "*** Объявляется двойной бонус опыта на 24 часов. ***"
// "*** Объявляется тройной бонус оружейного опыта на 23 часов. ***"
const BONUS_START_RE = /\*{3}\s*Объявляется\s+(.+?бонус.+?)\s+на\s+(\d+)\s+часо[вa]\.\s*\*{3}/i;
// "До конца бонуса осталось 3 часов."
const BONUS_REMAINING_RE = /До конца бонуса осталось\s+(\d+)\s+часо[вa]\./i;
// "Бонус закончился..."
const BONUS_ENDED_RE = /Бонус закончился\.\.\./i;

// "Аукцион : новый лот 0 - <название> - начальная ставка <цена> кун."
const AUCTION_NEW_LOT_RE = /Аукцион\s*:\s*новый лот\s+\d+\s*-\s*(.+?)\s*-\s*начальная ставка\s*([\d ]+)\s*кун/i;
// "Аукцион : лот 0(<название>) - новая ставка <цена> кун."
const AUCTION_NEW_BID_RE = /Аукцион\s*:\s*лот\s+\d+\((.+?)\)\s*-\s*новая ставка\s*([\d ]+)\s*кун/i;

const ANSI_ESCAPE_RE = /\u001b\[[0-9;]*m/g;

const DANCING_SHADOW_ITEMS = [
  "клинок танцующей тени",
  "заточка танцующей тени",
  "куртка танцующей тени",
  "браслет танцующей тени",
  "пояс танцующей тени",
];

const BONUS_REMAINING_NOTIFY_HOURS = new Set([1, 2, 3]);
const BAZAAR_AUTO_BUY_MAX_STEPS = 10;
const BAZAAR_ALIAS = "Базар";
const BAZAAR_ARRIVE_TIMEOUT_MS = 60_000;

export interface BazaarNotifierDependencies {
  telegramBotToken: string;
  telegramChatId: string;
  getCurrentRoomId: () => number | null;
  getPathLength: (fromVnum: number, toVnum: number) => Promise<number | null>;
  resolveAlias: (alias: string) => Promise<number[]>;
  navigateTo: (vnum: number) => Promise<void>;
  onceRoomChanged: (timeoutMs: number) => Promise<number | null>;
  isNavigating: () => boolean;
  isInCombat: () => boolean;
  sendCommand: (command: string) => void;
  onLog: (message: string) => void;
}

export interface BazaarNotifier {
  handleMudText(text: string): void;
}

export function createBazaarNotifier(deps: BazaarNotifierDependencies): BazaarNotifier {
  const {
    telegramBotToken,
    telegramChatId,
    getCurrentRoomId,
    getPathLength,
    resolveAlias,
    navigateTo,
    onceRoomChanged,
    isNavigating,
    isInCombat,
    sendCommand,
    onLog,
  } = deps;

  let autoBuyInProgress = false;

  function isWatchedItem(itemName: string): boolean {
    const lower = itemName.toLowerCase();
    return DANCING_SHADOW_ITEMS.some((watched) => lower.includes(watched));
  }

  async function sendTelegramMessage(text: string): Promise<void> {
    const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: telegramChatId,
        text,
        parse_mode: "HTML",
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram API error ${response.status}: ${body}`);
    }
  }

  function notify(message: string, logTag: string): void {
    onLog(`[bazaar-notifier] ${logTag}`);
    void sendTelegramMessage(message).catch((error: unknown) => {
      onLog(`[bazaar-notifier] Telegram send error: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  async function tryAutoBuy(lotNumber: string, itemName: string): Promise<void> {
    if (autoBuyInProgress) {
      onLog(`[bazaar-notifier] Auto-buy skipped: already in progress`);
      return;
    }
    if (isInCombat()) {
      onLog(`[bazaar-notifier] Auto-buy skipped: in combat`);
      return;
    }
    if (isNavigating()) {
      onLog(`[bazaar-notifier] Auto-buy skipped: navigation already active`);
      return;
    }

    const currentVnum = getCurrentRoomId();
    if (currentVnum === null) {
      onLog(`[bazaar-notifier] Auto-buy skipped: current room unknown`);
      return;
    }

    const bazaarVnums = await resolveAlias(BAZAAR_ALIAS);
    if (bazaarVnums.length === 0) {
      onLog(`[bazaar-notifier] Auto-buy skipped: alias "${BAZAAR_ALIAS}" not found`);
      return;
    }

    let nearestVnum: number | null = null;
    let nearestLen = Infinity;
    for (const vnum of bazaarVnums) {
      const len = await getPathLength(currentVnum, vnum);
      if (len !== null && len < nearestLen) {
        nearestLen = len;
        nearestVnum = vnum;
      }
    }

    if (nearestVnum === null || nearestLen > BAZAAR_AUTO_BUY_MAX_STEPS) {
      onLog(`[bazaar-notifier] Auto-buy skipped: nearest bazaar is ${nearestLen === Infinity ? "unreachable" : `${nearestLen} steps away (>${BAZAAR_AUTO_BUY_MAX_STEPS})`}`);
      return;
    }

    autoBuyInProgress = true;
    onLog(`[bazaar-notifier] Auto-buy: going to bazaar vnum=${nearestVnum} (${nearestLen} steps) for lot=${lotNumber}`);

    try {
      if (bazaarVnums.includes(currentVnum)) {
        onLog(`[bazaar-notifier] Auto-buy: already at bazaar, buying immediately`);
      } else {
        sendCommand("вста");
        void navigateTo(nearestVnum);

        const arrived = await onceRoomChanged(BAZAAR_ARRIVE_TIMEOUT_MS);
        if (arrived === null) {
          onLog(`[bazaar-notifier] Auto-buy: navigation timeout, aborting`);
          return;
        }

        let current = arrived;
        const deadline = Date.now() + BAZAAR_ARRIVE_TIMEOUT_MS;
        while (current !== nearestVnum && Date.now() < deadline) {
          const next = await onceRoomChanged(5_000);
          if (next === null) break;
          current = next;
        }

        if (current !== nearestVnum) {
          onLog(`[bazaar-notifier] Auto-buy: did not reach bazaar (last vnum=${current}), aborting`);
          return;
        }
      }

      sendCommand(`базар купить ${lotNumber}`);
      onLog(`[bazaar-notifier] Auto-buy: sent "базар купить ${lotNumber}" for "${itemName}"`);
      notify(
        `🛒 <b>Автопокупка!</b>\n\nПредмет: <b>${itemName}</b>\nКоманда: базар купить ${lotNumber}`,
        `Auto-buy command sent for lot=${lotNumber} item="${itemName}"`,
      );
    } finally {
      autoBuyInProgress = false;
    }
  }

  return {
    handleMudText(text: string): void {
      const stripped = text.replace(ANSI_ESCAPE_RE, "").replace(/\r/g, "");
      const lines = stripped.split("\n");

      for (const line of lines) {
        const trimmed = line.trim();

        const bazaarMatch = BAZAAR_NEW_LOT_RE.exec(trimmed);
        if (bazaarMatch) {
          const lotNumber = bazaarMatch[1] ?? "";
          const itemName = bazaarMatch[2]?.trim() ?? "";
          const price = bazaarMatch[3]?.replace(/\s+/g, "") ?? "";

          if (isWatchedItem(itemName)) {
            notify(
              `🗡 <b>Базар: новый лот!</b>\n\nПредмет: <b>${itemName}</b>\nЛот: #${lotNumber}\nЦена: ${price} кун`,
              `Watched item on bazaar: lot=${lotNumber} item="${itemName}" price=${price}`,
            );
            void tryAutoBuy(lotNumber, itemName).catch((error: unknown) => {
              onLog(`[bazaar-notifier] Auto-buy error: ${error instanceof Error ? error.message : String(error)}`);
            });
          }
          continue;
        }

        const bonusStartMatch = BONUS_START_RE.exec(trimmed);
        if (bonusStartMatch) {
          const description = bonusStartMatch[1]?.trim() ?? "";
          const hours = bonusStartMatch[2] ?? "?";
          notify(
            `🎉 <b>Бонус объявлен!</b>\n\n${description}\nДлительность: ${hours} ч`,
            `Bonus started: "${description}" for ${hours}h`,
          );
          continue;
        }

        const bonusRemainingMatch = BONUS_REMAINING_RE.exec(trimmed);
        if (bonusRemainingMatch) {
          const hours = Number(bonusRemainingMatch[1]);
          if (BONUS_REMAINING_NOTIFY_HOURS.has(hours)) {
            notify(
              `⏳ До конца бонуса осталось <b>${hours} ч</b>`,
              `Bonus ending soon: ${hours}h remaining`,
            );
          }
          continue;
        }

        if (BONUS_ENDED_RE.test(trimmed)) {
          notify(`🔕 <b>Бонус закончился</b>`, `Bonus ended`);
        }

        const auctionNewLotMatch = AUCTION_NEW_LOT_RE.exec(trimmed);
        if (auctionNewLotMatch) {
          const itemName = auctionNewLotMatch[1]?.trim() ?? "";
          const price = auctionNewLotMatch[2]?.replace(/\s+/g, "") ?? "";
          if (isWatchedItem(itemName)) {
            notify(
              `🔨 <b>Аукцион: новый лот!</b>\n\nПредмет: <b>${itemName}</b>\nНачальная ставка: ${price} кун`,
              `Auction new lot: item="${itemName}" startPrice=${price}`,
            );
          }
          continue;
        }

        const auctionNewBidMatch = AUCTION_NEW_BID_RE.exec(trimmed);
        if (auctionNewBidMatch) {
          const itemName = auctionNewBidMatch[1]?.trim() ?? "";
          const price = auctionNewBidMatch[2]?.replace(/\s+/g, "") ?? "";
          if (isWatchedItem(itemName)) {
            notify(
              `💰 <b>Аукцион: новая ставка!</b>\n\nПредмет: <b>${itemName}</b>\nСтавка: ${price} кун`,
              `Auction new bid: item="${itemName}" bid=${price}`,
            );
          }
        }
      }
    },
  };
}
