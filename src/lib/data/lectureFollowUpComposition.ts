import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { sendSlackDirectMessage } from "../slack/notifySlack";
import { openMongoLectureFollowUpRuntime } from "./mongoLectureFollowUpRuntime";
import type { LectureFollowUpNotifier } from "../reminders/lectureFollowUpReminder";
import { requireMongoShadowComposition, type MongoCompositionEnvironment } from "./mongoShadowComposition";
interface Client { connect(): Promise<unknown>; close(): Promise<void> } interface Runtime { run<T>(work: () => Promise<T>): Promise<T> }
export interface LectureFollowUpCompositionDependencies { createClient(environment: MongoCompositionEnvironment): Client; getNotifier(): LectureFollowUpNotifier; openRuntime(input: { client: Client; databaseName: string; namespace: string; allowShadowWrites: true; lectureFollowUpNotifier: LectureFollowUpNotifier }): Promise<Runtime> }
const defaults: LectureFollowUpCompositionDependencies = { createClient: environment => new MongoClient(configuredMongoUri(environment), mongoConnectionOptions()), getNotifier: () => ({ send: sendSlackDirectMessage }), openRuntime: input => openMongoLectureFollowUpRuntime({ ...input, client: input.client as MongoClient }) };
export async function runLectureFollowUpRequest<T>(work: () => Promise<T>, environment: MongoCompositionEnvironment = process.env, dependencies: LectureFollowUpCompositionDependencies = defaults): Promise<T> {
  const backend = environment.LECTURE_FOLLOW_UP_BACKEND?.trim() || "postgres"; if (backend === "postgres") return work(); if (backend !== "mongodb-shadow") throw new Error("LECTURE_FOLLOW_UP_COMPOSITION_FAILED"); let client: Client | undefined;
  try { const { databaseName, namespace } = requireMongoShadowComposition(environment); const notifier = dependencies.getNotifier(); client = dependencies.createClient(environment); await client.connect(); const runtime = await dependencies.openRuntime({ client, databaseName, namespace, allowShadowWrites: true, lectureFollowUpNotifier: notifier }); return await runtime.run(work); }
  catch (error) { const digest = error instanceof Error ? (error as Error & { digest?: unknown }).digest : undefined; if (typeof digest === "string" && /^NEXT_REDIRECT;(?:replace|push);.*;(?:303|307|308);$/.test(digest)) throw error; throw new Error("LECTURE_FOLLOW_UP_COMPOSITION_FAILED"); }
  finally { if (client) try { await client.close(); } catch {} }
}
