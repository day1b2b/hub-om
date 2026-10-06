import { diagnoseMongoConnection, MongoPreparationError } from "../src/lib/mongodb/connection";

// Use Node --env-file externally. No automatic dotenv scanning and no business data reads/writes.
if (process.argv.length !== 2) {
  console.error(JSON.stringify({ readyForCutover: false, code: "NO_ARGUMENTS_ACCEPTED" }));
  process.exitCode = 1;
} else {
  diagnoseMongoConnection().then(result => {
    console.log(JSON.stringify(result));
    if (!result.transactionsAdvertised) process.exitCode = 2;
  }).catch(error => {
    console.error(JSON.stringify({ readyForCutover: false, code: error instanceof MongoPreparationError ? error.code : "MONGODB_CHECK_FAILED" }));
    process.exitCode = 1;
  });
}
