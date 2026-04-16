// ---------------------------------------------------------------------------
// Chat-line detection for the MUD output stream.
//
// The game mixes chat, combat, and system text on the same TCP stream.
// We sniff out chat lines so the server can persist them and broadcast
// chat_message / chat_history events to browser clients separately from
// the raw `output` stream.
// ---------------------------------------------------------------------------

import { ANSI_ESCAPE_RE } from "./constants.ts";

/**
 * NPC speaker names that the MUD emits via ordinary "said" phrasing but
 * that we do not treat as chat — quest flavour rather than player comms.
 */
export const CHAT_FILTER_NAMES = [
  "Незнакомец", "Ворожея", "Кузнец", "Хитрый лавочник", "Здоровый дядька", "Владелец двора",
  "Раненый воин", "Травник", "Старец", "Пленник", "Девка для утех", "Леха Небокоптитель",
  "Боярин Вейдеров", "Старик", "Варяг", "Вальгрим", "Седовласый старик", "Пастух",
  "Краснодеревщик", "Староста", "Полуслепой немощный колдун",
  "Голодный зверюга", "Дружинник", "Желтоглазый дух леса", "Наворопник", "Нарочный",
  "Отшельник", "Боевой конь", "Ослик Иа", "Полосатый пчел", "Молодой цыган",
  "Юрий, сын Антонов", "страж лагеря", "Страж лагеря", "Старейшина",
  "Волх", "Глашатай", "Зажиточный муж", "Знахарь", "Корчмарь", "Латинский рыцарь",
  "Лихой человек", "Мастер Будулай", "Мясник", "Нищий странник", "Обеспокоенный кузнец",
  "Опытный охотник", "Перевозчик", "Переяславльский стражник", "Перун", "Святогор",
  "Сгорбленный старик", "Седой воин", "Седой паромщик", "Седой старец", "Старичок-болотник",
  "Страж ворот", "Странный тип", "Странствующий волхв Онуфрий", "Странствующий волшебник Петро",
  "Тюремщик", "Уставший рыбак", "Уставший старик", "Уцелевший купец", "Хмурый охотник",
  "десятник Никифор", "кладовщик Степан", "конюх Митроха", "трактирщик Жиртрестос",
  "Неприметный старичок", "Индус", "Луцкий сторож", "Хозяин двора",
  "Сухонькая старушка", "Рыжий трактирщик", "Пьяный медведь", "Леший",
  "Рыжий муравьишка", "Старый цыган", "сказитель", "Старый охотник", "Гадалка",
];

export function isChatLine(text: string): boolean {
  if (CHAT_FILTER_NAMES.some((name) => text.includes(name))) return false;
  return (
    /сказал[аи]?\s+вам\s*[:'"]/.test(text) ||
    /сказал[аи]?\s*:\s*'/.test(text) ||
    /Вы сказали\s*:\s*'/.test(text) ||
    /Вы сказали\s+\S+\s*:\s*'/.test(text) ||
    /Услышали вы голос/.test(text) ||
    /шепнул[аи]?\s+вам/.test(text) ||
    /дружине\s*:\s*'/.test(text) ||
    /Вы дружине\s*:\s*'/.test(text) ||
    /сообщил[аи]? группе\s*:\s*'/.test(text) ||
    /Вы сообщили группе\s*:\s*'/.test(text) ||
    /союзникам\s*:\s*'/.test(text) ||
    /Вы союзникам\s*:\s*'/.test(text)
  );
}

export function extractChatLines(mudText: string): string[] {
  const stripped = mudText.replace(ANSI_ESCAPE_RE, "").replace(/\r/g, "");
  const lines = stripped.split("\n");
  return lines.filter((line) => isChatLine(line.trim()));
}
