import { checkMongoDeploymentEnvironment, parseMongoDeploymentExpectation } from "../src/lib/data/mongoDeploymentCheck";

try {
  const expectation = parseMongoDeploymentExpectation(process.argv.slice(2));
  console.log(JSON.stringify(checkMongoDeploymentEnvironment(expectation, process.env)));
} catch {
  console.error(JSON.stringify({ readyFor: false, code: "MONGODB_DEPLOYMENT_CONFIGURATION_INVALID" }));
  process.exitCode = 1;
}
