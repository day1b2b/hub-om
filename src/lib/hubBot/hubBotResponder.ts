import { getDataRepositoryOverride } from "../data/dataRepositoryContext";
import { askHubBot, type HubBotChatTurn } from "./claudeClient";

export interface HubBotResponder {
  reply(question: string, history: HubBotChatTurn[]): Promise<string>;
}

const defaultResponder: HubBotResponder = Object.freeze({
  reply: askHubBot
});

export function getHubBotResponder(): HubBotResponder {
  return getDataRepositoryOverride("hubBotResponder") ?? defaultResponder;
}
