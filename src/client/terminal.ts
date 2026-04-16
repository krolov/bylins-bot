// ANSI parser + terminal output / chat appender.
//
// Owns the ANSI-SGR state machine and is the sole place that writes
// into `#output` / `#chat-output` DOM nodes. `main.ts` constructs one
// instance via `createTerminal(...)` at bootstrap and destructures the
// returned API for use across dispatcher / command-form / hotkeys /
// error paths.

import type { AnsiColorName, AnsiSegment, TerminalStyle } from "./types.ts";

const ESCAPE = "\u001b";
const MAX_OUTPUT_SEGMENTS = 2000;
const OUTPUT_TRIM_COUNT = 200;
const MAX_CHAT_LINES = 200;

export function createDefaultTerminalStyle(): TerminalStyle {
  return {
    foreground: "default",
    bold: false,
  };
}

function cloneStyle(style: TerminalStyle): TerminalStyle {
  return {
    foreground: style.foreground,
    bold: style.bold,
  };
}

function resetStyle(style: TerminalStyle): void {
  style.foreground = "default";
  style.bold = false;
}

function mapAnsiCodeToColor(code: number): AnsiColorName | null {
  switch (code) {
    case 30:
      return "black";
    case 31:
      return "red";
    case 32:
      return "green";
    case 33:
      return "yellow";
    case 34:
      return "blue";
    case 35:
      return "magenta";
    case 36:
      return "cyan";
    case 37:
      return "white";
    case 90:
      return "bright-black";
    case 91:
      return "bright-red";
    case 92:
      return "bright-green";
    case 93:
      return "bright-yellow";
    case 94:
      return "bright-blue";
    case 95:
      return "bright-magenta";
    case 96:
      return "bright-cyan";
    case 97:
      return "bright-white";
    default:
      return null;
  }
}

function applyAnsiCodes(style: TerminalStyle, codes: number[]): void {
  if (codes.length === 0) {
    resetStyle(style);
    return;
  }

  for (const code of codes) {
    if (code === 0) {
      resetStyle(style);
      continue;
    }

    if (code === 1) {
      style.bold = true;
      continue;
    }

    if (code === 22) {
      style.bold = false;
      continue;
    }

    if (code === 39) {
      style.foreground = "default";
      continue;
    }

    const color = mapAnsiCodeToColor(code);

    if (color) {
      style.foreground = color;
    }
  }
}

function classNamesForStyle(style: TerminalStyle): string[] {
  const classes = ["terminal-segment", `terminal-fg-${style.foreground}`];

  if (style.bold) {
    classes.push("terminal-bold");
  }

  return classes;
}

export interface TerminalApi {
  appendOutput(text: string): void;
  appendSystemLine(text: string): void;
  appendChatMessage(text: string, timestamp: number): void;
  appendStyledText(text: string, style: TerminalStyle): void;
  resetAnsiState(): void;
}

export function createTerminal(options: {
  outputElement: HTMLElement;
  chatOutputElement: HTMLElement;
  onRawText?: (text: string) => void;
}): TerminalApi {
  const { outputElement, chatOutputElement, onRawText } = options;
  const ansiState = {
    style: createDefaultTerminalStyle(),
    pendingEscape: "",
  };

  function isScrolledToBottom(): boolean {
    const threshold = 50;
    return outputElement.scrollHeight - outputElement.scrollTop - outputElement.clientHeight <= threshold;
  }

  function appendStyledText(text: string, style: TerminalStyle): void {
    if (text.length === 0) {
      return;
    }

    const span = document.createElement("span");
    span.className = classNamesForStyle(style).join(" ");
    span.textContent = text;
    outputElement.append(span);
  }

  function parseAnsiSegments(chunk: string): AnsiSegment[] {
    const segments: AnsiSegment[] = [];
    let text = `${ansiState.pendingEscape}${chunk}`;
    ansiState.pendingEscape = "";
    let cursor = 0;
    let currentText = "";

    const pushCurrentText = () => {
      if (currentText.length === 0) {
        return;
      }

      segments.push({
        text: currentText,
        style: cloneStyle(ansiState.style),
      });
      currentText = "";
    };

    while (cursor < text.length) {
      if (text[cursor] !== ESCAPE) {
        currentText += text[cursor];
        cursor += 1;
        continue;
      }

      const sequenceEnd = text.indexOf("m", cursor);

      if (sequenceEnd === -1) {
        ansiState.pendingEscape = text.slice(cursor);
        break;
      }

      pushCurrentText();

      const sequence = text.slice(cursor, sequenceEnd + 1);
      const sgrMatch = /^\u001b\[([0-9;]*)m$/.exec(sequence);

      if (!sgrMatch) {
        currentText += sequence;
        cursor = sequenceEnd + 1;
        continue;
      }

      const codes = sgrMatch[1]
        .split(";")
        .filter((part) => part.length > 0)
        .map((part) => Number(part))
        .filter((value) => Number.isInteger(value));

      applyAnsiCodes(ansiState.style, codes);
      cursor = sequenceEnd + 1;
    }

    pushCurrentText();
    return segments;
  }

  function appendChatMessage(text: string, timestamp: number): void {
    const isChatScrolledToBottom = chatOutputElement.scrollHeight - chatOutputElement.scrollTop - chatOutputElement.clientHeight <= 30;

    const line = document.createElement("span");
    line.className = "chat-line";

    const timeSpan = document.createElement("span");
    timeSpan.className = "chat-line__time";
    const d = new Date(timestamp);
    timeSpan.textContent = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    line.appendChild(timeSpan);

    const textSpan = document.createElement("span");
    textSpan.textContent = text;
    line.appendChild(textSpan);

    chatOutputElement.appendChild(line);

    const children = chatOutputElement.children;
    while (children.length > MAX_CHAT_LINES) {
      children[0]?.remove();
    }

    if (isChatScrolledToBottom) {
      chatOutputElement.scrollTop = chatOutputElement.scrollHeight;
    }
  }

  function appendOutput(text: string): void {
    const shouldAutoScroll = isScrolledToBottom();
    if (onRawText) onRawText(text);
    const segments = parseAnsiSegments(text);

    for (const segment of segments) {
      appendStyledText(segment.text, segment.style);
    }

    const children = outputElement.children;
    if (children.length > MAX_OUTPUT_SEGMENTS) {
      const scrollBefore = outputElement.scrollTop;
      const heightBefore = outputElement.scrollHeight;

      const toRemove = Math.min(OUTPUT_TRIM_COUNT, children.length - MAX_OUTPUT_SEGMENTS);
      for (let i = 0; i < toRemove; i++) {
        children[0]?.remove();
      }

      if (!shouldAutoScroll) {
        outputElement.scrollTop = scrollBefore - (heightBefore - outputElement.scrollHeight);
      }
    }

    if (shouldAutoScroll) {
      outputElement.scrollTop = outputElement.scrollHeight;
    }
  }

  function appendSystemLine(text: string): void {
    appendOutput(`\n[system] ${text}\n`);
  }

  function resetAnsiState(): void {
    ansiState.pendingEscape = "";
    ansiState.style = createDefaultTerminalStyle();
  }

  return {
    appendOutput,
    appendSystemLine,
    appendChatMessage,
    appendStyledText,
    resetAnsiState,
  };
}
