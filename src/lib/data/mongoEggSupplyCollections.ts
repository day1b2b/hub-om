import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
import { MongoOperationError, MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";

/**
 * 에그·운영물품 대여용 새 컬렉션 6개. 운영 헬스체크 대상(OPERATION_MODELS)이 아닌 별도 컬렉션이라,
 * 이 컬렉션이 운영에 없어도 기존 기능의 준비 상태 검사는 영향을 받지 않는다(/eggs·/mics만 열리지 않는다).
 * 절차: docs/operations/egg-supply-collections.md
 */
export const EGG_SUPPLY_MODELS = ["EggDevice", "EggRental", "EggGuide", "SupplyItem", "SupplyRental", "SupplyRentalItem"] as const;

export type EggSupplyCollectionState = "missing" | "ready" | "different";

export interface EggSupplyCollectionStatus {
  model: (typeof EGG_SUPPLY_MODELS)[number];
  collection: string;
  state: EggSupplyCollectionState;
}

/** 읽기 전용. 컬렉션이 없으면 missing, 계약과 같으면 ready, 있는데 다르면 different. */
export async function inspectEggSupplyCollections(options: MongoOperationOptions): Promise<EggSupplyCollectionStatus[]> {
  const statuses: EggSupplyCollectionStatus[] = [];
  for (const model of EGG_SUPPLY_MODELS) {
    const store = new MongoOperationStore(options, [model]);
    const collection = store.collection(model).collectionName;
    const exists = await store.db.listCollections({ name: collection }, { nameOnly: true }).hasNext();
    let state: EggSupplyCollectionState = "missing";
    if (exists) {
      try {
        await assertMongoReadStoreReady(store);
        state = "ready";
      } catch (error) {
        if (!(error instanceof MongoOperationError)) throw error;
        state = "different";
      }
    }
    statuses.push({ model, collection, state });
  }
  return statuses;
}

/**
 * 없는 컬렉션만 만든다. 이미 있는 컬렉션의 validator·index는 바꾸지 않는다.
 * 하나라도 계약과 다르면 아무것도 만들지 않고 멈춘다(사람이 원인을 먼저 확인).
 */
export async function createMissingEggSupplyCollections(
  options: MongoOperationOptions & { allowShadowWrites: true }
): Promise<{ created: string[]; alreadyReady: string[] }> {
  const before = await inspectEggSupplyCollections(options);
  if (before.some((status) => status.state === "different")) throw new MongoOperationError("EXISTING_COLLECTION_NOT_READY");

  const created: string[] = [];
  for (const status of before) {
    if (status.state !== "missing") continue;
    await prepareMongoReadStore(options, [status.model]);
    created.push(status.model);
  }

  const after = await inspectEggSupplyCollections(options);
  if (after.some((status) => status.state !== "ready")) throw new MongoOperationError("VALIDATOR_NOT_READY");
  return { created, alreadyReady: before.filter((status) => status.state === "ready").map((status) => status.model) };
}
