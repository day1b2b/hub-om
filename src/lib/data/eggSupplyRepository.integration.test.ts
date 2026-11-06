import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient } from "mongodb";
import { EggRentalConflictError } from "./eggs/eggRepository";
import { MONGO_EGG_RUNTIME_MODELS, MONGO_SUPPLY_RUNTIME_MODELS, prepareMongoEggSupplyRuntime } from "./mongoEggSupplyRuntime";
import { MongoOperationStore } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { completeMongoRow } from "./mongoOperationStore";
import { SupplyItemNotFoundError, SupplyRentalConflictError } from "./supplies/supplyRepository";

const email = "egg-supply-admin@day1company.co.kr";
const actor = { user: { email, name: "Synthetic supply admin" }, expires: "" };
mock.module("@/auth", { namedExports: { auth: async () => actor } });
// Mongo 모드에서 PostgreSQL로 새면 바로 실패하게 한다.
mock.module("./prisma", { namedExports: { getPrismaClient: () => { throw new Error("EGG_SUPPLY_PG_TRIPWIRE"); } } });
const hook = registerHooks({ resolve(specifier, context, next) { return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context); } });
const eggRentals = await import("../../app/api/eggs/rentals/route");
const eggDevices = await import("../../app/api/eggs/devices/route");
const supplyRentals = await import("../../app/api/supplies/rentals/route");
hook.deregister();

const uri = process.env.MONGODB_EGG_SUPPLY_TEST_URI;
const post = (path: string, body: unknown) => new Request(`https://example.invalid${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const device = (number: number) => ({
  part: "P12" as const, number, label: `에그 ${number}`, wifiName: `synthetic-wifi-${number}`, serialNumber: `SN-${number}`,
  wifiPassword: `synthetic-secret-${number}`, chargerType: "USB_C" as const, storageLocation: "캐비닛"
});
const rentalInput = (eggDeviceId: string, startDate: string, returnDueDate: string, borrowerName = "합성 대여자") =>
  ({ eggDeviceId, borrowerName, courseName: "합성 과정", startDate, returnDueDate });

test("egg and supply repositories store encrypted rows in Mongo and allow one of two overlapping rentals", { skip: !uri, timeout: 120_000 }, async () => {
  const target = new URL(uri!);
  assert.equal(target.hostname, "127.0.0.1");
  const client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 });
  const databaseName = `hub_om_shadow_egg_${randomBytes(8).toString("hex")}`;
  const namespace = `shadow_${randomBytes(8).toString("hex")}`;
  const names = ["DATABASE_URL", "OPERATION_PAGES_BACKEND", "MONGODB_URI", "MONGODB_SHADOW_DATABASE", "MONGODB_SHADOW_NAMESPACE", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "ADMIN_EMAILS", "DEV_AUTH_BYPASS"];
  const saved = new Map(names.map(name => [name, process.env[name]]));
  let connected = false;
  try {
    delete process.env.DATABASE_URL;
    delete process.env.DEV_AUTH_BYPASS;
    Object.assign(process.env, {
      OPERATION_PAGES_BACKEND: "mongodb-shadow", MONGODB_URI: uri!, MONGODB_SHADOW_DATABASE: databaseName, MONGODB_SHADOW_NAMESPACE: namespace,
      PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture",
      PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false", ADMIN_EMAILS: email
    });
    await client.connect();
    connected = true;
    const options = { client, databaseName, namespace, allowShadowWrites: true as const };
    const { eggs: eggRuntime, supplies: supplyRuntime } = await prepareMongoEggSupplyRuntime(options);
    const eggs = eggRuntime.repositories.eggs, supplies = supplyRuntime.repositories.supplies;
    const store = new MongoOperationStore(options, [...new Set([...MONGO_EGG_RUNTIME_MODELS, ...MONGO_SUPPLY_RUNTIME_MODELS])]);

    // 기기 등록: WiFi 비밀번호는 Mongo에 암호문으로, 화면에는 원문으로.
    const created = await eggs.createDevice(device(1));
    assert.equal(created.wifiPassword, "synthetic-secret-1");
    const rawDevice = await store.collection("EggDevice").findOne({ _id: created.id });
    assert.match(String(rawDevice?.wifiPassword), /^pii:v1:/);
    assert.equal((await eggs.listDevices())[0].wifiPassword, "synthetic-secret-1");

    // 같은 파트·번호는 409 (route)
    const duplicated = await eggDevices.POST(post("/api/eggs/devices", device(1)));
    assert.equal(duplicated.status, 409);

    // 예약 → 겹치는 예약은 409 (route), 겹치지 않으면 저장
    const first = await eggRentals.POST(post("/api/eggs/rentals", rentalInput(created.id, "2026-12-01", "2026-12-03")));
    assert.equal(first.status, 201);
    const overlap = await eggRentals.POST(post("/api/eggs/rentals", rentalInput(created.id, "2026-12-03", "2026-12-05")));
    assert.equal(overlap.status, 409);
    assert.match((await overlap.json()).error, /이미 예약된 기간과 겹칩니다/);
    assert.equal((await eggRentals.POST(post("/api/eggs/rentals", rentalInput(created.id, "2026-12-04", "2026-12-05")))).status, 201);

    // 동시에 같은 기간 두 건 → 하나만 성공
    const race = await Promise.allSettled([
      eggs.createRental(rentalInput(created.id, "2027-01-10", "2027-01-12", "동시 A"), email),
      eggs.createRental(rentalInput(created.id, "2027-01-11", "2027-01-13", "동시 B"), email)
    ]);
    assert.equal(race.filter(result => result.status === "fulfilled").length, 1);
    assert.ok(race.some(result => result.status === "rejected" && result.reason instanceof EggRentalConflictError));

    // 반납·취소·데이터 소진·주의사항
    const listed = await eggs.listRentals();
    assert.equal(listed.length, 3);
    await eggs.markReturned(listed[0].id, email);
    await eggs.cancelRental(listed[1].id, email);
    const after = await eggs.listRentals();
    assert.equal(after.length, 2);
    assert.equal(after.find(row => row.id === listed[0].id)?.returned, true);
    await eggs.setDataExhausted(created.id, true, "합성 사용자");
    assert.equal((await eggs.listDevices())[0].dataExhaustedBy, "합성 사용자");
    await eggs.saveGuide("P12", "합성 주의사항", email);
    await eggs.saveGuide("P12", "합성 주의사항 수정", email);
    assert.deepEqual((await eggs.listGuides()).map(row => row.content), ["합성 주의사항 수정"]);
    // 반납한 기간은 다시 예약할 수 있다
    await eggs.createRental(rentalInput(created.id, "2026-12-01", "2026-12-02"), email);

    // 운영물품: 존재하지 않는 물품은 400, 겹침은 409, 동시 두 건은 하나만
    const items = ["마이크 1", "마이크 2"].map((label, index) => completeMongoRow("SupplyItem", {
      id: `00000000-0000-4000-8000-00000000000${index + 1}`, category: "mic", label, storageLocation: "캐비닛", sortOrder: index,
      createdAt: new Date(), updatedAt: new Date()
    }));
    for (const row of items) await store.collection("SupplyItem").insertOne(encodeMongoRuntimeDocument("SupplyItem", row));
    const [mic1, mic2] = items.map(row => row.id as string);
    const supplyInput = (itemIds: string[], startDate: string, returnDueDate: string) =>
      ({ category: "mic", itemIds, borrowerName: "합성 대여자", courseName: "합성 과정", startDate, returnDueDate });
    assert.deepEqual((await supplies.listItems("mic")).map(row => row.label), ["마이크 1", "마이크 2"]);
    assert.equal((await supplyRentals.POST(post("/api/supplies/rentals", supplyInput([mic1, mic2], "2026-12-01", "2026-12-02")))).status, 201);
    assert.equal((await supplyRentals.POST(post("/api/supplies/rentals", supplyInput([mic2], "2026-12-02", "2026-12-03")))).status, 409);
    assert.equal((await supplyRentals.POST(post("/api/supplies/rentals", supplyInput(["00000000-0000-4000-8000-000000000009"], "2026-12-02", "2026-12-03")))).status, 400);
    await assert.rejects(supplies.createRental({ ...supplyInput([mic1], "2027-02-01", "2027-02-02"), category: "mic", itemIds: ["missing"] }, email), SupplyItemNotFoundError);
    const supplyRace = await Promise.allSettled([
      supplies.createRental({ ...supplyInput([mic1], "2027-03-01", "2027-03-02"), category: "mic" }, email),
      supplies.createRental({ ...supplyInput([mic1, mic2], "2027-03-02", "2027-03-04"), category: "mic" }, email)
    ]);
    assert.equal(supplyRace.filter(result => result.status === "fulfilled").length, 1);
    assert.ok(supplyRace.some(result => result.status === "rejected" && result.reason instanceof SupplyRentalConflictError));
    const supplyList = await supplies.listRentals("mic");
    assert.equal(supplyList.length, 2);
    assert.deepEqual(supplyList[0].itemIds, [mic1, mic2]);
    await supplies.markReturned(supplyList[0].id, email);
    await supplies.cancelRental(supplyList[1].id, email);
    assert.deepEqual((await supplies.listRentals("mic")).map(row => row.returned), [true]);

    // 요청 기록이 Mongo에 남고, 개인정보 원문은 어디에도 평문으로 저장되지 않는다.
    assert.ok(await store.collection("ActivityRequest").countDocuments() >= 6);
    const raw = JSON.stringify(await Promise.all(store.models.map(model => store.collection(model).find({}).toArray())));
    for (const value of ["synthetic-secret-1", "합성 대여자", "동시 A", "동시 B", email, "합성 주의사항"]) assert.equal(raw.includes(value), false, value);
  } finally {
    try { if (connected) await client.db(databaseName).dropDatabase(); }
    finally {
      try { await client.close(); }
      finally { for (const name of names) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
    }
  }
});
