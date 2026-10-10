export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  from?: { id: number };
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly telegramDescription: string | null = null,
  ) {
    super(message);
  }
}

export class TelegramClient {
  private readonly apiUrl: string;

  constructor(private readonly token: string) {
    this.apiUrl = `https://api.telegram.org/bot${token}`;
  }

  async getMe(): Promise<{ username?: string }> {
    return this.call<{ username?: string }>("getMe");
  }

  async setMyCommands(commands: readonly { command: string; description: string }[]): Promise<void> {
    await this.call<boolean>("setMyCommands", { commands });
  }

  async getUpdates(offset: number | null, timeoutSeconds: number, signal: AbortSignal): Promise<TelegramUpdate[]> {
    const updates = await this.call<TelegramUpdate[]>("getUpdates", {
      offset: offset ?? undefined,
      timeout: timeoutSeconds,
      allowed_updates: ["message"],
    }, signal);
    return updates;
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
    await this.call("sendMessage", { chat_id: chatId, text });
  }

  private async call<T>(method: string, body?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.apiUrl}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
        signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new TelegramApiError("Telegram API network request failed");
    }

    let payload: TelegramResponse<T>;
    try {
      payload = (await response.json()) as TelegramResponse<T>;
    } catch {
      throw new TelegramApiError("Telegram API returned invalid JSON", response.status);
    }

    if (!response.ok || !payload.ok || payload.result === undefined) {
      const description = payload.description ?? "Telegram API request failed";
      throw new TelegramApiError(
        `Telegram API ${method} failed`,
        response.status,
        description,
      );
    }
    return payload.result;
  }
}
